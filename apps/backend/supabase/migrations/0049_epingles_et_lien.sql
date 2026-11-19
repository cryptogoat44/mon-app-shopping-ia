-- 0049 (lot « vie sociale », 2026-11-19) : épingler des publications, et un
-- lien en bio. Un membre peut épingler jusqu'à 3 de ses publications « Une
-- photo » en haut de son profil, et afficher sous sa bio un lien vers un site
-- web (une adresse https, 200 caractères au plus).
--
-- Retour en arrière (après avoir remis un serveur qui ne connaît pas 0049 ;
-- les épingles et les liens des profils sont alors perdus, rien d'autre).
-- D'abord relancer le fichier 0037 en entier (rejouable sans effet) : il remet
-- sa fonction moderation_remove_profile_part, qui ne parle pas du lien. Puis :
--   drop index if exists posts_pinned_idx;
--   alter table posts drop column if exists pinned_at;
--   alter table profiles drop constraint if exists profiles_link_url_check;
--   alter table profiles drop column if exists link_url;
--
-- Ce qu'elle ajoute :
-- 1. posts.pinned_at : la date de l'épingle, vide pour une publication qui
--    n'est pas épinglée (toutes, au départ). La limite de 3 est tenue par le
--    serveur (il compte, puis épingle) : deux épingles au même instant peuvent
--    au pire en donner 4, et la lecture ne garde que les 3 plus récentes. Un
--    index sur les seules publications épinglées sert cette lecture.
-- 2. profiles.link_url : le lien affiché sur le profil, vide au départ. La
--    base n'accepte qu'une adresse qui commence par « https:// », sans espace,
--    de 200 caractères au plus ; le serveur vérifie le reste (nom de site
--    ordinaire, sans identifiant ni port, ni adresse IP, ni caractères
--    accentués ou spéciaux dans le nom du site). Effacé avec le profil.
-- 3. « Retirer la bio » (modération) retire aussi le lien, dans la même
--    transaction : la fonction moderation_remove_profile_part de 0037 est
--    recréée à l'identique (mêmes paramètres, mêmes réponses, mêmes droits),
--    sauf pour la bio. Elle vide désormais la bio ET le lien, et elle
--    accepte un profil qui n'a qu'un lien, sans bio. Avant, ce lien ne
--    pouvait partir qu'en suspendant tout le compte (« rien à retirer »).
--    La photo de profil ne change pas.
--
-- Facultative pour le serveur : sans elle, l'app cache « Épingler sur mon
-- profil » et le champ « Lien », et les routes répondent « indisponible »
-- (sonde du schéma, lib/profileExtras.ts). Aucune exigence au-delà de ce qui
-- est déjà en production : À appliquer APRÈS 0037 (modération des profils,
-- en production depuis le 15 nov. 2026 ; elle-même après 0026), vérifié
-- ci-dessous avant tout changement. D'abord sur spotto-dev-2 (migrer-dev),
-- puis sur spotto-prod. Indépendante de 0045, 0046, 0047 et 0048.
-- Rejouable sans effet (if not exists, contrainte remplacée par son nom,
-- create or replace) ; ne supprime ni ne modifie aucune donnée existante. Ne
-- relancez pas 0037 après 0049 (sa fonction oublierait le lien) ; si c'est
-- fait, relancez 0049. Aucune règle d'accès nouvelle : posts et profiles gardent
-- leur RLS active sans politique, seul le serveur, avec sa clé secrète, les
-- lit et les écrit ; la fonction reste réservée au serveur.
-- Aucun déclencheur.

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'moderation_remove_profile_part') then
    raise exception '0049 demande la migration 0037 (modération des profils) : appliquez-la d''abord, puis relancez 0049.';
  end if;
end;
$$;

-- ---- Publications épinglées ----
alter table posts add column if not exists pinned_at timestamptz;
-- Les publications épinglées d'un membre, les plus récemment épinglées d'abord.
create index if not exists posts_pinned_idx on posts (user_id, pinned_at desc) where pinned_at is not null;

-- ---- Lien en bio ----
alter table profiles add column if not exists link_url text;
alter table profiles drop constraint if exists profiles_link_url_check;
alter table profiles add constraint profiles_link_url_check
  check (link_url is null or (char_length(link_url) <= 200 and link_url ~ '^https://[^[:space:]]+$'));

-- ---- Retirer la bio retire aussi le lien ----
-- La fonction de 0037, recopiée ; seules changent les lignes du lien
-- (v_link). p_part = 'bio' : « rien à retirer » seulement sans bio NI lien ;
-- sinon la bio et le lien sont vidés ensemble. Le rôle est toujours vérifié
-- AVANT tout verrou (le serveur s'en sert pour savoir si la fonction existe).
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
  v_link text;
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

  select true, pr.bio, pr.link_url, pr.avatar_url into v_found, v_bio, v_link, v_avatar
    from profiles pr where pr.id = p_user_id for update;
  if v_found is null then
    return query select 'target_not_found'::text, null::uuid;
    return;
  end if;
  if (p_part = 'bio' and (v_bio is null or btrim(v_bio) = '') and v_link is null)
     or (p_part = 'avatar' and v_avatar is null) then
    return query select 'nothing_to_remove'::text, null::uuid;
    return;
  end if;

  insert into moderation_actions (admin_id, action, target_type, target_id, target_user_id, reason, note)
    values (p_admin_id, case p_part when 'bio' then 'remove_bio' else 'remove_avatar' end,
            'user', p_user_id, p_user_id, p_reason, nullif(btrim(p_note), ''))
    returning id into v_action;
  if p_part = 'bio' then
    update profiles set bio = null, link_url = null, updated_at = now() where id = p_user_id;
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

-- Le serveur seul, comme en 0037 : ni les visiteurs, ni les comptes connectés.
revoke all on function moderation_remove_profile_part(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function moderation_remove_profile_part(uuid, uuid, text, text, text) to service_role;

notify pgrst, 'reload schema';
