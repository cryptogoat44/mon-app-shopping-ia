-- 0037 (lot « conformité Apple », 2026-11-10) : la modération peut retirer la
-- bio ou la photo d'un profil (règle 1.2 d'Apple : pouvoir retirer un contenu
-- choquant). Avant, un profil ne pouvait qu'être suspendu, et sa bio ou sa
-- photo restait en place.
--
-- Retour en arrière (le serveur actuel fonctionne sans 0037 ; redémarrez-le
-- ensuite pour qu'il relise la base). Une bio ou une photo déjà retirée le
-- reste (rien n'en est gardé) ; les décisions « bio retirée » et « photo
-- retirée » et leurs notifications sont alors perdues (les signalements
-- qu'elles avaient traités restent traités) :
--   drop function if exists moderation_remove_profile_part(uuid, uuid, text, text, text);
--   delete from notifications n using moderation_actions m
--     where n.moderation_action_id = m.id and m.action in ('remove_bio', 'remove_avatar');
--   delete from moderation_actions where action in ('remove_bio', 'remove_avatar');
--   alter table moderation_actions drop constraint if exists moderation_actions_action_check;
--   alter table moderation_actions add constraint moderation_actions_action_check
--     check (action in ('dismiss', 'hide', 'suspend', 'restore', 'unsuspend', 'remove_image'));
--
-- Ce qu'elle ajoute :
-- 1. Deux décisions dans le journal de la modération (moderation_actions) :
--    'remove_bio' et 'remove_avatar', toujours sur un compte (target_type
--    'user').
-- 2. La fonction moderation_remove_profile_part : en une seule transaction,
--    la bio ou l'adresse de la photo est vidée, la décision est écrite au
--    journal avec son motif, la personne est prévenue (notification
--    « moderation », comme pour un masquage) et les signalements ouverts de
--    ce profil sont classés (leurs auteurs apprennent qu'ils sont traités,
--    jamais la décision). Pour la photo, le serveur efface le fichier AVANT
--    d'appeler la fonction. Ne s'annule pas : moderation_undo (0026) répond
--    déjà « target_not_found » pour une décision qui n'est ni un masquage ni
--    une suspension ; elle n'a pas à changer.
--
-- Aucune table ni colonne nouvelle : les règles d'accès (RLS) ne changent
-- pas. La fonction est réservée au serveur, comme les autres fonctions de la
-- modération.
--
-- Facultative pour le serveur : sans elle, « Retirer la bio » et « Retirer la
-- photo de profil » ne sont pas proposés à l'administrateur, et la route
-- répond « indisponible » (sonde, lib/profileModeration.ts). Cacher la bio
-- et la photo d'un compte SUSPENDU ne demande pas cette migration (le
-- serveur le fait à la lecture). À appliquer APRÈS 0026 (vérifié
-- ci-dessous), d'abord sur spotto-dev-2 (migrer-dev), puis sur spotto-prod.
-- Rejouable sans effet (drop constraint if exists, create or replace) ; ne
-- supprime ni ne modifie aucune donnée existante.

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'moderation_remove_image') then
    raise exception 'Appliquez d''abord la migration 0026 (retrait d''une image copiée), puis relancez 0037.';
  end if;
end;
$$;

-- ---- Deux décisions de plus au journal ----
alter table moderation_actions drop constraint if exists moderation_actions_action_check;
alter table moderation_actions add constraint moderation_actions_action_check
  check (action in ('dismiss', 'hide', 'suspend', 'restore', 'unsuspend', 'remove_image', 'remove_bio', 'remove_avatar'));

-- Retirer la bio (p_part = 'bio') ou la photo (p_part = 'avatar') d'un
-- profil. outcome : « ok », ou la raison du refus (not_admin, invalid,
-- target_not_found, nothing_to_remove). Le rôle est vérifié AVANT tout
-- verrou : le serveur s'en sert aussi pour savoir si la fonction existe (un
-- appel sans administrateur ne fait rien et ne bloque personne).
create or replace function moderation_remove_profile_part(
  p_admin_id uuid,
  p_user_id uuid,
  p_part text,
  p_reason text,
  p_note text
)
returns table (outcome text, action_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_found boolean;
  v_bio text;
  v_avatar text;
  v_action uuid;
begin
  if p_admin_id is null or not exists (select 1 from admins a where a.user_id = p_admin_id) then
    return query select 'not_admin'::text, null::uuid;
    return;
  end if;
  if p_part is null or p_part not in ('bio', 'avatar')
     or p_reason is null or p_reason not in ('spam', 'inappropriate', 'harassment', 'other') then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;
  perform pg_advisory_xact_lock(hashtext('spotto_moderation'));

  select true, pr.bio, pr.avatar_url into v_found, v_bio, v_avatar
    from profiles pr where pr.id = p_user_id for update;
  if v_found is null then
    return query select 'target_not_found'::text, null::uuid;
    return;
  end if;
  if (p_part = 'bio' and (v_bio is null or btrim(v_bio) = ''))
     or (p_part = 'avatar' and v_avatar is null) then
    return query select 'nothing_to_remove'::text, null::uuid;
    return;
  end if;

  insert into moderation_actions (admin_id, action, target_type, target_id, target_user_id, reason, note)
    values (p_admin_id, case p_part when 'bio' then 'remove_bio' else 'remove_avatar' end,
            'user', p_user_id, p_user_id, p_reason, nullif(btrim(p_note), ''))
    returning id into v_action;
  if p_part = 'bio' then
    update profiles set bio = null, updated_at = now() where id = p_user_id;
  else
    update profiles set avatar_url = null, updated_at = now() where id = p_user_id;
  end if;
  insert into notifications (user_id, actor_id, type, moderation_action_id) values (p_user_id, null, 'moderation', v_action);

  with handled as (
    update reports r set handled_at = now(), moderation_action_id = v_action
    where r.target_type = 'user' and r.target_id = p_user_id and r.handled_at is null
    returning r.reporter_id
  )
  insert into notifications (user_id, actor_id, type, moderation_action_id)
    select distinct h.reporter_id, null::uuid, 'report_handled', v_action from handled h;

  return query select 'ok'::text, v_action;
end;
$$;

-- Le serveur seul : ni les visiteurs, ni les comptes connectés.
revoke all on function moderation_remove_profile_part(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function moderation_remove_profile_part(uuid, uuid, text, text, text) to service_role;

notify pgrst, 'reload schema';
