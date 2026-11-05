-- Chantier 3 de la feuille de route V1 (comptes et modération, point 6 ;
-- règle 1.2 d'Apple) : un contenu signalé par plusieurs personnes
-- DIFFÉRENTES est masqué aussitôt, en attendant la décision d'un
-- administrateur.
--
-- Facultative pour le serveur : sans elle, il enregistre les signalements
-- comme avant et ne masque rien automatiquement (lib/autoHide.ts détecte
-- l'absence de moderation_auto_hide). À appliquer à la main par le
-- fondateur, d'abord sur spotto-dev-2, puis sur spotto-prod.
-- Rejouable sans effet (if not exists, create or replace) ; ne supprime ni
-- ne modifie aucune donnée existante.
--
-- Ce qu'elle change :
-- 1. Le journal sait qu'une décision est automatique (colonne `automatic`).
-- 2. moderation_auto_hide : masque un contenu (publication, commentaire,
--    pièce envoyée) dès que N personnes différentes l'ont signalé (N fixé
--    par le serveur : 3), sans compter l'auteur ni les signalements déjà
--    traités ou antérieurs à un rétablissement. La personne concernée est
--    prévenue ; les signalements restent « à traiter ».
-- 3. moderation_apply (reprise de la version de 0024) : sur un contenu
--    masqué automatiquement, « Masquer » CONFIRME le masquage (au lieu de
--    répondre « déjà masqué »), et « Classer sans suite » le RÉTABLIT
--    (décision « rétabli » au journal, personne concernée prévenue).
-- 4. Un index pour retrouver vite les signalements d'une personne (son fil
--    ne montre plus ce qu'elle a signalé).

alter table moderation_actions add column if not exists automatic boolean not null default false;

create index if not exists reports_reporter_id_target_type_idx on reports (reporter_id, target_type, created_at desc);

-- Masquage automatique, en une seule transaction. outcome : « ok », ou la
-- raison pour laquelle rien n'est masqué (invalid, target_not_found,
-- already_hidden, below_threshold).
create or replace function moderation_auto_hide(p_target_type text, p_target_id uuid, p_threshold integer)
returns table (outcome text, action_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_user uuid;
  v_hidden timestamptz;
  v_since timestamptz;
  v_reporters integer;
  v_reason text;
  v_action uuid;
begin
  perform pg_advisory_xact_lock(hashtext('spotto_moderation'));
  if p_target_type is null or p_target_type not in ('post', 'comment', 'piece') or coalesce(p_threshold, 0) < 2 then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  if p_target_type = 'post' then
    select p.user_id, p.hidden_at into v_user, v_hidden from posts p where p.id = p_target_id;
  elsif p_target_type = 'comment' then
    select c.user_id, c.hidden_at into v_user, v_hidden from comments c where c.id = p_target_id;
  else
    select s.sender_id, s.hidden_at into v_user, v_hidden from piece_sends s where s.id = p_target_id;
  end if;
  if v_user is null then
    return query select 'target_not_found'::text, null::uuid;
    return;
  end if;
  if v_hidden is not null then
    return query select 'already_hidden'::text, null::uuid;
    return;
  end if;

  -- Un contenu rétabli par un administrateur ne se remasque qu'avec de
  -- NOUVEAUX signalements, faits après ce rétablissement.
  select max(m.created_at) into v_since
    from moderation_actions m
    where m.target_type = p_target_type and m.target_id = p_target_id and m.action = 'restore';

  select count(distinct r.reporter_id)::integer into v_reporters
    from reports r
    where r.target_type = p_target_type and r.target_id = p_target_id
      and r.handled_at is null
      and r.reporter_id <> v_user
      and (v_since is null or r.created_at > v_since);
  if v_reporters < p_threshold then
    return query select 'below_threshold'::text, null::uuid;
    return;
  end if;

  -- Motif : le plus fréquent parmi ces signalements.
  select r.reason into v_reason
    from reports r
    where r.target_type = p_target_type and r.target_id = p_target_id
      and r.handled_at is null
      and r.reporter_id <> v_user
      and (v_since is null or r.created_at > v_since)
    group by r.reason
    order by count(*) desc, r.reason
    limit 1;

  insert into moderation_actions (admin_id, action, target_type, target_id, target_user_id, reason, note, automatic)
    values (null, 'hide', p_target_type, p_target_id, v_user, v_reason, null, true)
    returning id into v_action;
  perform moderation_set_hidden(p_target_type, p_target_id, now());
  insert into notifications (user_id, actor_id, type, moderation_action_id) values (v_user, null, 'moderation', v_action);

  return query select 'ok'::text, v_action;
end;
$$;

-- Une décision d'administrateur, en une seule transaction. Reprend la
-- version de la migration 0024 ; seul ajout : le masquage automatique en
-- vigueur (v_auto), confirmé par « Masquer », levé par « Classer sans suite ».
create or replace function moderation_apply(
  p_admin_id uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_note text
)
returns table (outcome text, action_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_user uuid;
  v_action uuid;
  v_open boolean;
  v_hidden boolean;
  v_auto uuid;
  v_restore uuid;
begin
  perform pg_advisory_xact_lock(hashtext('spotto_moderation'));
  if not exists (select 1 from admins a where a.user_id = p_admin_id) then
    return query select 'not_admin'::text, null::uuid;
    return;
  end if;
  if p_action is null or p_action not in ('dismiss', 'hide', 'suspend')
     or p_target_type is null or p_target_type not in ('user', 'post', 'comment', 'piece')
     or (p_action = 'hide' and p_target_type = 'user')
     or (p_action in ('hide', 'suspend') and p_reason is null) then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  v_user := case p_target_type
    when 'post' then (select p.user_id from posts p where p.id = p_target_id)
    when 'comment' then (select c.user_id from comments c where c.id = p_target_id)
    when 'piece' then (select s.sender_id from piece_sends s where s.id = p_target_id)
    else (select pr.id from profiles pr where pr.id = p_target_id)
  end;
  v_open := exists (select 1 from reports r where r.target_type = p_target_type and r.target_id = p_target_id and r.handled_at is null);
  if v_user is null and (p_action <> 'dismiss' or not v_open) then
    return query select 'target_not_found'::text, null::uuid;
    return;
  end if;
  if p_action = 'dismiss' and not v_open then
    return query select 'already_handled'::text, null::uuid;
    return;
  end if;

  v_hidden := case p_target_type
    when 'post' then exists (select 1 from posts p where p.id = p_target_id and p.hidden_at is not null)
    when 'comment' then exists (select 1 from comments c where c.id = p_target_id and c.hidden_at is not null)
    when 'piece' then exists (select 1 from piece_sends s where s.id = p_target_id and s.hidden_at is not null)
    else false
  end;
  -- Masquage automatique encore en vigueur (jamais annulé ni confirmé).
  if v_hidden then
    select m.id into v_auto
      from moderation_actions m
      where m.target_type = p_target_type and m.target_id = p_target_id and m.action = 'hide' and m.automatic
        and not exists (select 1 from moderation_actions u where u.undoes_action_id = m.id)
      order by m.created_at desc
      limit 1;
  end if;

  if p_action = 'hide' and v_hidden and v_auto is null then
    return query select 'already_hidden'::text, null::uuid;
    return;
  end if;
  if p_action = 'suspend' and exists (select 1 from suspensions s where s.user_id = v_user) then
    return query select 'already_suspended'::text, null::uuid;
    return;
  end if;

  -- Confirmer un masquage automatique : la décision de l'administrateur le
  -- remplace (undoes_action_id), le contenu reste masqué.
  insert into moderation_actions (admin_id, action, target_type, target_id, target_user_id, reason, note, undoes_action_id)
    values (p_admin_id, p_action, p_target_type, p_target_id, v_user, p_reason, nullif(btrim(p_note), ''),
            case when p_action = 'hide' then v_auto end)
    returning id into v_action;

  if p_action = 'hide' then
    perform moderation_set_hidden(p_target_type, p_target_id, now());
  elsif p_action = 'suspend' then
    insert into suspensions (user_id, moderation_action_id) values (v_user, v_action);
  elsif p_action = 'dismiss' and v_auto is not null then
    -- Classé sans suite : le masquage automatique est levé, la personne
    -- concernée apprend que son contenu est rétabli.
    insert into moderation_actions (admin_id, action, target_type, target_id, target_user_id, undoes_action_id)
      values (p_admin_id, 'restore', p_target_type, p_target_id, v_user, v_auto)
      returning id into v_restore;
    perform moderation_set_hidden(p_target_type, p_target_id, null);
    insert into notifications (user_id, actor_id, type, moderation_action_id) values (v_user, null, 'moderation', v_restore);
  end if;

  -- La personne concernée est prévenue, sauf d'un classement sans suite, et
  -- sauf d'une confirmation : elle a déjà appris le masquage automatique.
  if p_action <> 'dismiss' and not (p_action = 'hide' and v_auto is not null) then
    insert into notifications (user_id, actor_id, type, moderation_action_id) values (v_user, null, 'moderation', v_action);
  end if;

  with handled as (
    update reports r set handled_at = now(), moderation_action_id = v_action
    where r.target_type = p_target_type and r.target_id = p_target_id and r.handled_at is null
    returning r.reporter_id
  )
  insert into notifications (user_id, actor_id, type, moderation_action_id)
    select distinct h.reporter_id, null::uuid, 'report_handled', v_action from handled h;

  return query select 'ok'::text, v_action;
end;
$$;

-- Le serveur seul : ni les visiteurs, ni les comptes connectés.
revoke all on function moderation_auto_hide(text, uuid, integer) from public, anon, authenticated;
grant execute on function moderation_auto_hide(text, uuid, integer) to service_role;
revoke all on function moderation_apply(uuid, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function moderation_apply(uuid, text, text, uuid, text, text) to service_role;

notify pgrst, 'reload schema';
