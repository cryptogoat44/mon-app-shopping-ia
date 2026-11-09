-- 0034 (lot « modération des collections », 2026-11-09) : signaler une
-- collection montrée par un ami, et la modérer (règle 1.2 d'Apple).
--
-- Retour en arrière (le serveur actuel fonctionne sans 0034 ; redémarrez-le
-- ensuite pour qu'il relise la base). Les signalements de collections et les
-- décisions prises sur elles sont alors perdus ; une suspension décidée
-- depuis une collection signalée reste en place ; une image retirée le reste
-- (l'envie est montrée sans image, et une nouvelle copie sera faite) :
--   update moderation_actions set target_type = 'user', target_id = target_user_id
--     where target_type = 'collection' and action in ('suspend', 'unsuspend');
--   delete from notifications n using moderation_actions m
--     where n.moderation_action_id = m.id and m.target_type = 'collection';
--   delete from reports where target_type = 'collection';
--   delete from moderation_actions where target_type = 'collection';
--   drop function if exists moderation_remove_collection_image(uuid, uuid, uuid, text);
--   alter table collections drop column if exists hidden_at;
--   delete from collection_image_copies where image_removed_at is not null;
--   alter table collection_image_copies drop constraint if exists collection_image_copies_removed_check;
--   alter table collection_image_copies drop column if exists image_removed_at;
--   alter table collection_image_copies alter column image_url set not null;
--   alter table collection_image_copies alter column image_thumb_url set not null;
--   alter table reports drop constraint if exists reports_target_type_check;
--   alter table reports add constraint reports_target_type_check
--     check (target_type in ('user', 'post', 'comment', 'piece', 'message'));
--   alter table moderation_actions drop constraint if exists moderation_actions_target_type_check;
--   alter table moderation_actions add constraint moderation_actions_target_type_check
--     check (target_type in ('user', 'post', 'comment', 'piece', 'message'));
-- puis relancer le fichier 0030_masquage_automatique.sql en entier, puis le
-- fichier 0032_messages.sql en entier (dans cet ordre : ils remettent les
-- fonctions de la modération sans les collections).
--
-- Ce qu'elle ajoute :
-- 1. Le type 'collection' dans les signalements (reports) et le journal de la
--    modération (moderation_actions).
-- 2. collections.hidden_at : masquée par la modération (les amis ne la voient
--    plus ; son auteur ne peut pas la remontrer à ses amis tant qu'elle l'est).
-- 3. collection_image_copies.image_removed_at : la copie de l'image d'une
--    envie retirée par la modération. La ligne reste, sans adresse : l'envie
--    est montrée aux amis avec « Image indisponible », et aucune nouvelle
--    copie n'est faite (le fichier est effacé par le serveur AVANT).
-- 4. Les fonctions de la modération, reprises telles quelles, avec les
--    collections en plus : moderation_set_hidden et moderation_apply (version
--    de 0032), moderation_auto_hide (version de 0030 : masquage après 3
--    personnes différentes). Nouvelle : moderation_remove_collection_image.
--    moderation_undo et moderation_queue (0026, 0023) n'ont pas à changer.
--
-- Facultative pour le serveur : sans elle, « Signaler » est caché pour les
-- collections, un signalement de collection reçoit « indisponible », et les
-- collections fonctionnent comme avant (sonde du schéma,
-- lib/collectionModeration.ts). À appliquer APRÈS 0030, 0032 et 0033
-- (vérifié ci-dessous), d'abord sur spotto-dev-2 (migrer-dev), puis sur
-- spotto-prod. Ne relancez pas 0030 ni 0032 après 0034 (elles remettraient
-- les fonctions sans les collections) ; si c'est fait, relancez 0034.
-- Rejouable sans effet (if not exists, create or replace) ; ne supprime ni ne
-- modifie aucune donnée existante.

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'moderation_auto_hide') then
    raise exception 'Appliquez d''abord la migration 0030 (masquage automatique), puis 0032 et 0033, puis relancez 0034.';
  end if;
  if to_regclass('public.messages') is null then
    raise exception 'Appliquez d''abord la migration 0032 (messages privés), puis 0033, puis relancez 0034.';
  end if;
  if to_regclass('public.collections') is null or to_regclass('public.collection_image_copies') is null then
    raise exception 'Appliquez d''abord la migration 0033 (collections), puis relancez 0034.';
  end if;
end;
$$;

-- ---- Signaler une collection ----
alter table reports drop constraint if exists reports_target_type_check;
alter table reports add constraint reports_target_type_check
  check (target_type in ('user', 'post', 'comment', 'piece', 'message', 'collection'));
alter table moderation_actions drop constraint if exists moderation_actions_target_type_check;
alter table moderation_actions add constraint moderation_actions_target_type_check
  check (target_type in ('user', 'post', 'comment', 'piece', 'message', 'collection'));

-- ---- Collection masquée par la modération ----
alter table collections add column if not exists hidden_at timestamptz;

-- ---- Copie d'une image retirée par la modération ----
alter table collection_image_copies add column if not exists image_removed_at timestamptz;
alter table collection_image_copies alter column image_url drop not null;
alter table collection_image_copies alter column image_thumb_url drop not null;
-- Les deux adresses, ou (retirée) aucune : jamais une image à moitié.
alter table collection_image_copies drop constraint if exists collection_image_copies_removed_check;
alter table collection_image_copies add constraint collection_image_copies_removed_check
  check ((image_removed_at is null and image_url is not null and image_thumb_url is not null)
      or (image_removed_at is not null and image_url is null and image_thumb_url is null));

-- Masquer (p_at = maintenant) ou rétablir (p_at = null) un contenu. Reprend
-- la version de la migration 0032 et ajoute la collection.
create or replace function moderation_set_hidden(p_target_type text, p_target_id uuid, p_at timestamptz)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_target_type = 'post' then
    update posts set hidden_at = p_at where id = p_target_id;
    update notifications n set hidden_at = p_at
      where n.post_id = p_target_id and n.type in ('like', 'comment')
        and (p_at is not null or n.comment_id is null
             or not exists (select 1 from comments c where c.id = n.comment_id and c.hidden_at is not null));
  elsif p_target_type = 'comment' then
    update comments set hidden_at = p_at where id = p_target_id;
    update notifications n set hidden_at = p_at
      where n.comment_id = p_target_id
        and (p_at is not null
             or not exists (select 1 from comments c join posts p on p.id = c.post_id where c.id = p_target_id and p.hidden_at is not null));
  elsif p_target_type = 'piece' then
    update piece_sends set hidden_at = p_at where id = p_target_id;
    update notifications n set hidden_at = p_at where n.piece_send_id = p_target_id;
  elsif p_target_type = 'message' then
    update messages set hidden_at = p_at where id = p_target_id;
  elsif p_target_type = 'collection' then
    update collections set hidden_at = p_at where id = p_target_id;
  end if;
end;
$$;

-- Une décision d'administrateur, en une seule transaction. Reprend la
-- version de la migration 0032 ; seul ajout : la collection (personne
-- concernée : celle à qui elle appartient).
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
     or p_target_type is null or p_target_type not in ('user', 'post', 'comment', 'piece', 'message', 'collection')
     or (p_action = 'hide' and p_target_type = 'user')
     or (p_action in ('hide', 'suspend') and p_reason is null) then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  v_user := case p_target_type
    when 'post' then (select p.user_id from posts p where p.id = p_target_id)
    when 'comment' then (select c.user_id from comments c where c.id = p_target_id)
    when 'piece' then (select s.sender_id from piece_sends s where s.id = p_target_id)
    when 'message' then (select m.sender_id from messages m where m.id = p_target_id)
    when 'collection' then (select k.user_id from collections k where k.id = p_target_id)
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
    when 'message' then exists (select 1 from messages m where m.id = p_target_id and m.hidden_at is not null)
    when 'collection' then exists (select 1 from collections k where k.id = p_target_id and k.hidden_at is not null)
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

-- Masquage automatique, en une seule transaction. Reprend la version de la
-- migration 0030 ; seul ajout : la collection (que seuls des amis de son
-- auteur peuvent signaler).
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
  if p_target_type is null or p_target_type not in ('post', 'comment', 'piece', 'collection') or coalesce(p_threshold, 0) < 2 then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  if p_target_type = 'post' then
    select p.user_id, p.hidden_at into v_user, v_hidden from posts p where p.id = p_target_id;
  elsif p_target_type = 'comment' then
    select c.user_id, c.hidden_at into v_user, v_hidden from comments c where c.id = p_target_id;
  elsif p_target_type = 'collection' then
    select k.user_id, k.hidden_at into v_user, v_hidden from collections k where k.id = p_target_id;
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

  -- Signalements qui comptent, contre les masquages abusifs (relecture
  -- sécurité du chantier 3) :
  -- - pas ceux d'un compte créé depuis moins d'un jour au moment du
  --   signalement : trois comptes jetables, créés à la minute, ne font plus
  --   disparaître le contenu de quelqu'un ;
  -- - pas ceux d'un compte suspendu (il peut encore signaler, mais ne masque
  --   plus rien) ;
  -- - pas ceux d'une personne dont un administrateur a déjà traité un
  --   signalement de ce contenu, ou qui l'avait signalé avant son
  --   rétablissement : un contenu rétabli ou « classé sans suite » ne peut
  --   pas être remasqué aussitôt par les mêmes personnes (rien n'empêche de
  --   signaler deux fois). Il faut trois personnes nouvelles.
  with eligible as (
    select r.reporter_id, r.reason
      from reports r
      join profiles p on p.id = r.reporter_id
      where r.target_type = p_target_type and r.target_id = p_target_id
        and r.handled_at is null
        and r.reporter_id <> v_user
        and (v_since is null or r.created_at > v_since)
        and r.created_at >= p.created_at + interval '1 day'
        and not exists (select 1 from suspensions s where s.user_id = r.reporter_id)
        and not exists (
          select 1 from reports o
          where o.target_type = p_target_type and o.target_id = p_target_id and o.reporter_id = r.reporter_id
            and (o.handled_at is not null or (v_since is not null and o.created_at <= v_since))
        )
  )
  select
    (select count(distinct e.reporter_id)::integer from eligible e),
    -- Motif : le plus fréquent parmi ces signalements.
    (select e.reason from eligible e group by e.reason order by count(*) desc, e.reason limit 1)
    into v_reporters, v_reason;
  if v_reporters < p_threshold then
    return query select 'below_threshold'::text, null::uuid;
    return;
  end if;

  insert into moderation_actions (admin_id, action, target_type, target_id, target_user_id, reason, note, automatic)
    values (null, 'hide', p_target_type, p_target_id, v_user, v_reason, null, true)
    returning id into v_action;
  perform moderation_set_hidden(p_target_type, p_target_id, now());
  insert into notifications (user_id, actor_id, type, moderation_action_id) values (v_user, null, 'moderation', v_action);

  return query select 'ok'::text, v_action;
end;
$$;

-- Retirer la copie de l'image d'une envie d'une collection, en une seule
-- opération (comme moderation_remove_image, migration 0026) : adresses
-- vidées, date du retrait, décision au journal (sur la collection), personne
-- prévenue avec le motif neutre « droits sur l'image », signalements de la
-- collection classés. Le serveur a déjà effacé les fichiers. outcome :
-- « ok », ou la raison du refus (not_admin, target_not_found, no_copy,
-- already_removed). Ne s'annule pas (moderation_undo : « not_undoable »).
create or replace function moderation_remove_collection_image(p_admin_id uuid, p_collection_id uuid, p_item_id uuid, p_note text)
returns table (outcome text, action_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_owner uuid;
  v_wish uuid;
  v_found boolean;
  v_removed timestamptz;
  v_action uuid;
begin
  perform pg_advisory_xact_lock(hashtext('spotto_moderation'));
  if not exists (select 1 from admins a where a.user_id = p_admin_id) then
    return query select 'not_admin'::text, null::uuid;
    return;
  end if;
  select i.user_id, i.wishlist_item_id into v_owner, v_wish
    from collection_items i where i.id = p_item_id and i.collection_id = p_collection_id;
  if v_owner is null then
    return query select 'target_not_found'::text, null::uuid;
    return;
  end if;
  select true, c.image_removed_at into v_found, v_removed
    from collection_image_copies c where c.wishlist_item_id = v_wish and c.user_id = v_owner for update;
  if v_found is null then
    return query select 'no_copy'::text, null::uuid;
    return;
  end if;
  if v_removed is not null then
    return query select 'already_removed'::text, null::uuid;
    return;
  end if;

  insert into moderation_actions (admin_id, action, target_type, target_id, target_user_id, reason, note)
    values (p_admin_id, 'remove_image', 'collection', p_collection_id, v_owner, 'image_rights', nullif(btrim(p_note), ''))
    returning id into v_action;
  update collection_image_copies set image_url = null, image_thumb_url = null, image_removed_at = now()
    where wishlist_item_id = v_wish and user_id = v_owner;
  insert into notifications (user_id, actor_id, type, moderation_action_id) values (v_owner, null, 'moderation', v_action);

  with handled as (
    update reports r set handled_at = now(), moderation_action_id = v_action
    where r.target_type = 'collection' and r.target_id = p_collection_id and r.handled_at is null
    returning r.reporter_id
  )
  insert into notifications (user_id, actor_id, type, moderation_action_id)
    select distinct h.reporter_id, null::uuid, 'report_handled', v_action from handled h;

  return query select 'ok'::text, v_action;
end;
$$;

-- Le serveur seul : ni les visiteurs, ni les comptes connectés.
revoke all on function moderation_set_hidden(text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function moderation_set_hidden(text, uuid, timestamptz) to service_role;
revoke all on function moderation_apply(uuid, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function moderation_apply(uuid, text, text, uuid, text, text) to service_role;
revoke all on function moderation_auto_hide(text, uuid, integer) from public, anon, authenticated;
grant execute on function moderation_auto_hide(text, uuid, integer) to service_role;
revoke all on function moderation_remove_collection_image(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function moderation_remove_collection_image(uuid, uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
