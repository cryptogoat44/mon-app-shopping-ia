-- Lot 5, partie B (décisions du fondateur, 2026-10-15) : « Retirer l'image
-- copiée ». Seulement les copies d'images de marchands faites par notre
-- serveur (publication « envie », pièce envoyée), jamais la photo publiée
-- par une personne (elle a déjà « masquer »). Décision réservée aux
-- administrateurs, inscrite au journal comme les autres ; la personne est
-- prévenue, avec un motif neutre (« droits sur l'image ») ; la publication ou
-- la pièce reste visible, avec « Image indisponible », son titre et le lien
-- vers le marchand. Le serveur efface D'ABORD les fichiers (lib/storage.ts :
-- 3 essais) ; s'ils refusent de s'effacer, rien n'est enregistré et
-- l'administrateur recommence. Puis cette fonction enregistre la décision,
-- qui ne s'annule pas (le fichier n'existe plus).
-- Rejouable sans effet (if not exists, drop … if exists).

-- Date du retrait : distingue « image retirée » de « pas d'image ».
alter table posts add column if not exists media_removed_at timestamptz;
alter table piece_sends add column if not exists image_removed_at timestamptz;
-- Une pièce dont l'image est retirée n'a plus d'adresse d'image.
alter table piece_sends alter column image_url drop not null;
alter table piece_sends alter column image_thumb_url drop not null;

-- Journal : nouvelle décision, et son motif neutre.
alter table moderation_actions drop constraint if exists moderation_actions_action_check;
alter table moderation_actions add constraint moderation_actions_action_check
  check (action in ('dismiss', 'hide', 'suspend', 'restore', 'unsuspend', 'remove_image'));
alter table moderation_actions drop constraint if exists moderation_actions_reason_check;
alter table moderation_actions add constraint moderation_actions_reason_check
  check (reason is null or reason in ('spam', 'inappropriate', 'harassment', 'other', 'image_rights'));

-- Retirer l'image copiée, en une seule opération : adresses vidées, date du
-- retrait, décision au journal, personne prévenue, signalements classés.
-- outcome : « ok », ou la raison du refus (not_admin, invalid,
-- target_not_found, not_a_copy, already_removed) — revérifiée ici même si le
-- serveur l'a déjà contrôlée avant d'effacer les fichiers.
create or replace function moderation_remove_image(p_admin_id uuid, p_target_type text, p_target_id uuid, p_note text)
returns table (outcome text, action_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_owner uuid;
  v_removed timestamptz;
  v_is_copy boolean;
  v_action uuid;
begin
  perform pg_advisory_xact_lock(hashtext('spotto_moderation'));
  if not exists (select 1 from admins a where a.user_id = p_admin_id) then
    return query select 'not_admin'::text, null::uuid;
    return;
  end if;
  if p_target_type = 'post' then
    select p.user_id, p.media_removed_at, p.type::text = 'wish'
      into v_owner, v_removed, v_is_copy
      from posts p where p.id = p_target_id for update;
  elsif p_target_type = 'piece' then
    select s.sender_id, s.image_removed_at, true
      into v_owner, v_removed, v_is_copy
      from piece_sends s where s.id = p_target_id for update;
  else
    return query select 'invalid'::text, null::uuid;
    return;
  end if;
  if v_owner is null then
    return query select 'target_not_found'::text, null::uuid;
    return;
  end if;
  -- Une photo publiée par une personne (look, achat) n'est jamais concernée.
  if not v_is_copy then
    return query select 'not_a_copy'::text, null::uuid;
    return;
  end if;
  if v_removed is not null then
    return query select 'already_removed'::text, null::uuid;
    return;
  end if;

  insert into moderation_actions (admin_id, action, target_type, target_id, target_user_id, reason, note)
    values (p_admin_id, 'remove_image', p_target_type, p_target_id, v_owner, 'image_rights', nullif(btrim(p_note), ''))
    returning id into v_action;
  if p_target_type = 'post' then
    update posts set media_url = null, media_thumb_url = null, media_removed_at = now() where id = p_target_id;
  else
    update piece_sends set image_url = null, image_thumb_url = null, image_removed_at = now() where id = p_target_id;
  end if;
  insert into notifications (user_id, actor_id, type, moderation_action_id) values (v_owner, null, 'moderation', v_action);

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

-- Annuler une décision encore en vigueur (rétablir un contenu, lever une
-- suspension). Nouveau : un retrait d'image ne s'annule pas (le fichier est
-- effacé) — refus explicite « not_undoable ».
create or replace function moderation_undo(p_admin_id uuid, p_action_id uuid, p_note text)
returns table (outcome text, action_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_original moderation_actions%rowtype;
  v_undo text;
  v_action uuid;
begin
  perform pg_advisory_xact_lock(hashtext('spotto_moderation'));
  if not exists (select 1 from admins a where a.user_id = p_admin_id) then
    return query select 'not_admin'::text, null::uuid;
    return;
  end if;
  select * into v_original from moderation_actions m where m.id = p_action_id;
  if found and v_original.action = 'remove_image' then
    return query select 'not_undoable'::text, null::uuid;
    return;
  end if;
  if not found or v_original.action not in ('hide', 'suspend') then
    return query select 'target_not_found'::text, null::uuid;
    return;
  end if;
  if exists (select 1 from moderation_actions m where m.undoes_action_id = p_action_id)
     or (v_original.action = 'suspend' and not exists (select 1 from suspensions s where s.moderation_action_id = p_action_id)) then
    return query select 'already_undone'::text, null::uuid;
    return;
  end if;

  v_undo := case v_original.action when 'hide' then 'restore' else 'unsuspend' end;
  insert into moderation_actions (admin_id, action, target_type, target_id, target_user_id, note, undoes_action_id)
    values (p_admin_id, v_undo, v_original.target_type, v_original.target_id, v_original.target_user_id, nullif(btrim(p_note), ''), p_action_id)
    returning id into v_action;

  if v_undo = 'restore' then
    perform moderation_set_hidden(v_original.target_type, v_original.target_id, null);
  else
    delete from suspensions s where s.moderation_action_id = p_action_id;
  end if;
  insert into notifications (user_id, actor_id, type, moderation_action_id)
    values (v_original.target_user_id, null, 'moderation', v_action);

  return query select 'ok'::text, v_action;
end;
$$;

-- Le serveur seul : ni les visiteurs, ni les comptes connectés.
revoke all on function moderation_remove_image(uuid, text, uuid, text) from public, anon, authenticated;
grant execute on function moderation_remove_image(uuid, text, uuid, text) to service_role;
revoke all on function moderation_undo(uuid, uuid, text) from public, anon, authenticated;
grant execute on function moderation_undo(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
