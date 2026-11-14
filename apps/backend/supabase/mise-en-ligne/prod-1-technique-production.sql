-- Mise en production groupée 1 sur 3 (lot de novembre 2026) : technique,
-- rien de visible pour les membres. À coller EN ENTIER dans l'éditeur SQL de
-- Supabase, projet spotto-prod (adresse contenant selhqdqfrflsqivgxypf),
-- puis « Run ». Ensuite, coller prod-1-technique-verification.sql : 3 lignes
-- (0029, 0035, 0037), toutes avec tout_est_bon = true.
--
-- AUCUNE SAUVEGARDE : la base de production n'en a aucune (offre gratuite
-- de Supabase, rien dans Database → Backups ; voir RESTAURATION.md). Faites
-- D'ABORD la copie de sauvegarde de spotto-prod, et ne collez ce fichier
-- qu'une fois cette copie faite. Si vous enchaînez prod-1, prod-2 et prod-3
-- dans la même séance, la copie faite juste avant prod-1 sert aux trois.
--
-- AVANT : rien à déployer. Le serveur déjà en ligne (main 4772655) connaît
-- ces trois migrations et fonctionne avec ou sans chacune ; il voit seul
-- qu'elles sont là, en 5 minutes au plus (ses sondes sont refaites toutes
-- les 5 minutes).
--
-- Contenu, dans cet ordre (chaque fichier est recopié tel quel depuis
-- supabase/migrations/, sans aucun changement ; le test
-- tests/migrationsProductionGroupees.test.ts le vérifie) :
--   0029 — garde-fous du serveur : des index (suppression d'un compte,
--          purge de l'historique), les compteurs de l'IA dans la base
--          (table ai_calls, fonction ai_quota), et une recherche en panne
--          ne compte plus dans la part du jour de la personne
--          (serpapi_quota, remplacée : mêmes paramètres, mêmes droits) ;
--   0035 — les appareils prévenus des nouveaux messages (table
--          push_tokens) ; aucune notification ne part tant que
--          PUSH_ENABLED ne vaut pas « true » chez Render ;
--   0037 — la modération peut retirer la bio ou la photo d'un profil
--          (demande 0026, déjà en production : vérifié au début de 0037).
-- Aucune donnée existante n'est supprimée ni modifiée : deux tables neuves
-- (vides), des index, deux fonctions nouvelles et une remplacée, une règle
-- du journal de la modération élargie (deux décisions de plus).
-- 0035 doit passer AVANT prod-3-alertes-production.sql (0036 la demande).
--
-- Rejouable : relancer ce fichier en entier ne change rien.
-- Tout ou rien : l'éditeur l'exécute en une seule transaction. En cas
-- d'erreur, rien n'a changé : copier le message à Claude, ne rien corriger
-- à la main.
-- « destructive operation » : Supabase ne devrait PAS l'afficher pour ce
-- fichier (aucun « drop », « delete » ni « truncate »). S'il l'affiche quand
-- même, c'est pour 0037, qui retire et recrée aussitôt la règle
-- moderation_actions_action_check (« alter table … drop constraint if
-- exists ») : vous pouvez confirmer (« Run this query »).
-- Vérification : prod-1-technique-verification.sql (lecture seule).
-- Retour en arrière : voir l'en-tête de chaque migration, dans l'ordre
-- inverse (0037, 0035, puis 0029).

-- ========================================================================
-- 0029_garde_fous.sql
-- ========================================================================

-- 0029 (lot « garde-fous du serveur », chantier 2 de la feuille de route V1,
-- 2026-11-05). Trois changements, tous rejouables sans effet (if not exists,
-- create or replace) :
-- 1. des index, pour que la suppression d'un compte et la purge de
--    l'historique restent rapides avec le volume (point 18) ;
-- 2. les compteurs de l'IA d'Anthropic dans la base (point 9) : table
--    ai_calls et fonction ai_quota. En mémoire, ils repartaient de zéro à
--    chaque redémarrage du serveur ;
-- 3. serpapi_quota : une recherche qui a échoué pour une raison technique
--    (panne ou délai du fournisseur, enregistrement raté, recherche
--    interrompue) ne compte plus dans la part du jour de la personne
--    (point 15). Les plafonds du jour et du mois, eux, comptent toujours
--    chaque appel réel.
--
-- Le serveur fonctionne AVEC ou SANS cette migration :
-- - sans ai_quota, il garde ses compteurs de l'IA en mémoire, comme avant
--   (lib/aiQuota.ts, journal « Compteurs IA en mémoire : migration 0029 absente ») ;
-- - serpapi_quota garde ses paramètres et ce qu'elle renvoie : un serveur
--   plus ancien la lit sans changement ;
-- - les index ne changent aucun résultat.
-- Un serveur plus ancien sur une base migrée : ai_calls reste vide, rien
-- d'autre ne change.
--
-- Données personnelles : ai_calls garde, pour l'analyse automatique d'une
-- vidéo seulement, le compte et l'heure de l'appel — rien d'autre (ni image,
-- ni texte, ni réponse) —, pour la limite de 10 analyses par personne et par
-- jour. Chaque ligne est effacée au bout de 2 jours, et avec le compte
-- (cascade). Les appels de l'IA de la voie C n'ont pas de compte.
--
-- Retour en arrière (sur la base visée, dans cet ordre ; le serveur repasse
-- de lui-même aux compteurs en mémoire) :
--   drop function if exists ai_quota(text, uuid, integer, integer, boolean, timestamptz);
--   drop table if exists ai_calls;
--   puis recréer serpapi_quota avec le corps exact de 0028 ;
--   les index peuvent rester.

-- ---- 1. Index (point 18) ----
-- Chaque clé étrangère sans index fait relire toute la table à chaque ligne
-- supprimée de la table qu'elle désigne (suppression d'un compte, d'une
-- recherche, d'une publication). Tables encore petites : chaque index se crée
-- en un instant.
create index if not exists affiliate_links_product_match_id_idx on affiliate_links (product_match_id);
create index if not exists affiliate_clicks_affiliate_link_id_idx on affiliate_clicks (affiliate_link_id);
create index if not exists affiliate_conversions_affiliate_click_id_idx on affiliate_conversions (affiliate_click_id);
create index if not exists vault_items_product_match_id_idx on vault_items (product_match_id);
create index if not exists vault_items_affiliate_conversion_id_idx on vault_items (affiliate_conversion_id);
create index if not exists wishlist_items_product_match_id_idx on wishlist_items (product_match_id);
create index if not exists post_tagged_pieces_product_match_id_idx on post_tagged_pieces (product_match_id);
create index if not exists post_tagged_pieces_vault_item_id_idx on post_tagged_pieces (vault_item_id);
create index if not exists posts_vault_item_id_idx on posts (vault_item_id);
create index if not exists post_reactions_user_id_idx on post_reactions (user_id);
create index if not exists notifications_actor_id_idx on notifications (actor_id);
create index if not exists notifications_post_id_idx on notifications (post_id);
create index if not exists notifications_comment_id_idx on notifications (comment_id);
create index if not exists reports_reporter_id_idx on reports (reporter_id);
create index if not exists consents_user_id_idx on consents (user_id);
create index if not exists data_export_requests_user_id_idx on data_export_requests (user_id);

-- ---- 2. Compteurs de l'IA (point 9) ----
-- kind : 'video' (analyse automatique d'une vidéo, avec le compte) ou
-- 'shopping_query' (requête des boutiques écrite par l'IA, voie C, sans compte).
-- Lue et écrite uniquement par le serveur (clé service_role) : RLS active,
-- aucune politique.
create table if not exists ai_calls (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('video', 'shopping_query')),
  user_id uuid references profiles(id) on delete cascade,
  called_at timestamptz not null default now(),
  check (kind = 'video' or user_id is null)
);
create index if not exists ai_calls_kind_called_at_idx on ai_calls (kind, called_at);
create index if not exists ai_calls_user_id_called_at_idx on ai_calls (user_id, called_at) where user_id is not null;
alter table ai_calls enable row level security;
revoke all on table ai_calls from public, anon, authenticated;
grant select, insert, delete on table ai_calls to service_role;

-- Réserve un appel (p_reserve = true) ou lit seulement l'état (false). Deux
-- plafonds par jour (heure de Paris), dans cet ordre : la part de la personne
-- (p_user_daily_cap, absent pour l'IA de la voie C), puis tout le service
-- (p_daily_cap) ; refused_by dit lequel est atteint ('user' ou 'global').
-- Atomique : un verrou de transaction met les demandes en file, et l'instant
-- de référence est lu APRÈS ce verrou (comme serpapi_quota).
-- Minimisation : chaque appel du serveur efface les lignes de plus de 2 jours.
-- p_at : un instant fixé, pour les tests seulement (dans le passé, jamais mêlé
-- aux vrais appels ; sans effacement) ; le serveur ne le donne jamais.
create or replace function ai_quota(
  p_kind text,
  p_user_id uuid,
  p_user_daily_cap integer,
  p_daily_cap integer,
  p_reserve boolean,
  p_at timestamptz default null
)
returns table (allowed boolean, refused_by text, day_count integer, user_day_count integer)
language plpgsql
set search_path = public
as $$
declare
  v_at timestamptz;
  v_day_start timestamptz;
  v_day integer;
  v_user integer := 0;
  v_per_user boolean := p_user_daily_cap is not null;
begin
  if p_kind is null or p_kind not in ('video', 'shopping_query') or p_daily_cap is null or p_daily_cap < 1 or p_reserve is null
     or (v_per_user and (p_user_daily_cap < 1 or p_user_id is null or p_kind <> 'video')) then
    raise exception 'ai_quota : paramètres invalides';
  end if;
  perform pg_advisory_xact_lock(hashtext('ai_quota'));
  v_at := coalesce(p_at, clock_timestamp());
  v_day_start := date_trunc('day', v_at at time zone 'Europe/Paris') at time zone 'Europe/Paris';
  if p_at is null then
    delete from ai_calls where called_at < v_at - interval '2 days';
  end if;

  select count(*) into v_day
    from ai_calls c
    where c.kind = p_kind and c.called_at >= v_day_start and c.called_at <= v_at;
  if v_per_user then
    select count(*) into v_user
      from ai_calls c
      where c.kind = p_kind and c.user_id = p_user_id and c.called_at >= v_day_start and c.called_at <= v_at;
  end if;

  if v_per_user and v_user >= p_user_daily_cap then
    return query select false, 'user'::text, v_day, v_user;
    return;
  end if;
  if v_day >= p_daily_cap then
    return query select false, 'global'::text, v_day, v_user;
    return;
  end if;

  if p_reserve then
    insert into ai_calls (kind, user_id, called_at) values (p_kind, case when v_per_user then p_user_id end, v_at);
    v_day := v_day + 1;
    if v_per_user then
      v_user := v_user + 1;
    end if;
  end if;
  return query select true, null::text, v_day, v_user;
end;
$$;

revoke all on function ai_quota(text, uuid, integer, integer, boolean, timestamptz) from public, anon, authenticated;
grant execute on function ai_quota(text, uuid, integer, integer, boolean, timestamptz) to service_role;

-- ---- 3. serpapi_quota : les échecs techniques hors de la part de la personne (point 15) ----
-- Corps copié tel quel de 0028, mêmes paramètres, mêmes valeurs par défaut,
-- même type renvoyé (d'où « create or replace », sans suppression). Une seule
-- condition changée, dans le compte de la part de la personne :
-- « and s.failure_kind is distinct from 'provider_refused' » devient
-- « and s.failure_kind is null ». Une recherche en cours, aboutie, ou qui n'a
-- rien trouvé compte toujours ; une recherche en panne (failure_kind rempli :
-- délai dépassé, erreur ou refus du fournisseur, réponse illisible,
-- enregistrement raté, recherche interrompue) ne compte plus.
create or replace function serpapi_quota(
  p_daily_cap integer,
  p_monthly_cap integer,
  p_user_daily_cap integer,
  p_renewal_day integer,
  p_user_id uuid,
  p_reserve boolean,
  p_exclude_search uuid default null,
  p_at timestamptz default null
)
returns table (allowed boolean, refused_by text, day_count integer, month_count integer, user_day_count integer, next_renewal date, reservation_id bigint)
language plpgsql
set search_path = public
as $$
declare
  v_at timestamptz;
  v_day_start timestamptz;
  v_cycle_start timestamptz;
  v_next date;
  v_day integer;
  v_month integer;
  v_user integer;
  v_stores integer;
  v_reservation bigint;
begin
  if p_daily_cap is null or p_monthly_cap is null or p_user_daily_cap is null or p_user_id is null
     or p_daily_cap < 1 or p_monthly_cap < 1 or p_user_daily_cap < 1 then
    raise exception 'serpapi_quota : paramètres invalides';
  end if;
  perform pg_advisory_xact_lock(hashtext('serpapi_quota'));
  v_at := coalesce(p_at, clock_timestamp());
  v_day_start := date_trunc('day', v_at at time zone 'Europe/Paris') at time zone 'Europe/Paris';
  v_cycle_start := serpapi_cycle_start(p_renewal_day, v_at);
  v_next := serpapi_next_renewal(p_renewal_day, v_at);

  -- Le jour commence toujours dans le cycle en cours (au plus tôt, avec lui).
  select count(*) filter (where c.called_at >= v_day_start), count(*)
    into v_day, v_month
    from serpapi_calls c
    where c.called_at >= v_cycle_start and c.called_at <= v_at
      and c.released_at is null;

  select count(*)
    into v_user
    from product_searches s
    where s.user_id = p_user_id
      and s.status in ('processing', 'completed', 'failed')
      and s.created_at >= v_day_start and s.created_at <= v_at
      and s.id is distinct from p_exclude_search
      and s.failure_kind is null
      and not s.served_from_cache;

  select count(*)
    into v_stores
    from product_matches m
    join product_searches s on s.id = m.search_id
    where s.user_id = p_user_id
      and m.stores_requested_at >= v_day_start and m.stores_requested_at <= v_at;
  v_user := v_user + v_stores;

  if v_month >= p_monthly_cap then
    return query select false, 'month'::text, v_day, v_month, v_user, v_next, null::bigint;
    return;
  end if;
  if v_user >= p_user_daily_cap then
    return query select false, 'user'::text, v_day, v_month, v_user, v_next, null::bigint;
    return;
  end if;
  if v_day >= p_daily_cap then
    return query select false, 'day'::text, v_day, v_month, v_user, v_next, null::bigint;
    return;
  end if;

  if p_reserve then
    insert into serpapi_calls (called_at) values (v_at) returning id into v_reservation;
    v_day := v_day + 1;
    v_month := v_month + 1;
    v_user := v_user + 1;
  end if;
  return query select true, null::text, v_day, v_month, v_user, v_next, v_reservation;
end;
$$;

-- Le serveur seul : ni les visiteurs, ni les comptes connectés.
revoke all on function serpapi_quota(integer, integer, integer, integer, uuid, boolean, uuid, timestamptz) from public, anon, authenticated;
grant execute on function serpapi_quota(integer, integer, integer, integer, uuid, boolean, uuid, timestamptz) to service_role;

notify pgrst, 'reload schema';

-- ========================================================================
-- 0035_notifications_telephone.sql
-- ========================================================================

-- 0035 (lot « notifications sur le téléphone », 2026-11-09) : les appareils
-- prévenus des nouveaux messages privés.
--
-- Retour en arrière (après avoir remis un serveur qui ne connaît pas 0035,
-- ou simplement coupé PUSH_ENABLED ; les appareils enregistrés sont alors
-- oubliés, rien d'autre ne change) :
--   drop table if exists push_tokens;
--
-- Ce qu'elle ajoute :
-- push_tokens : un appareil qui reçoit les notifications des nouveaux
-- messages. Le jeton donné par Expo (« ExponentPushToken[…] »), unique : un
-- téléphone n'est qu'à un seul compte à la fois. Le système (iPhone ou
-- Android), les dates d'enregistrement et de mise à jour, et le code de la
-- dernière erreur renvoyée par Expo (par exemple « MessageRateExceeded »),
-- jamais un texte. Supprimé avec le compte (cascade), quand la personne
-- coupe les notifications ou se déconnecte, et quand Expo dit que
-- l'appareil n'est plus inscrit.
--
-- Facultative pour le serveur : sans elle, rien n'est enregistré ni envoyé,
-- et l'app ne propose pas les notifications (sonde du schéma, lib/push.ts).
-- Les notifications restent aussi coupées tant que PUSH_ENABLED ne vaut pas
-- « true » chez Render. À appliquer d'abord sur spotto-dev-2 (migrer-dev),
-- puis sur spotto-prod. Rejouable sans effet (if not exists) ; ne supprime
-- ni ne modifie aucune donnée existante.
-- Aucune règle d'accès public : seul le serveur, avec sa clé secrète, lit et
-- écrit cette table (RLS active, aucune politique).

create table if not exists push_tokens (
  token text primary key check (char_length(token) between 10 and 200),
  user_id uuid not null references profiles(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_error text check (last_error is null or char_length(last_error) <= 60)
);
-- Les appareils d'un membre (envoi d'une notification, export, suppression).
create index if not exists push_tokens_user_idx on push_tokens (user_id, updated_at desc);
alter table push_tokens enable row level security;

-- Le serveur seul : ni les visiteurs, ni les comptes connectés.
revoke all on table push_tokens from public, anon, authenticated;
grant select, insert, update, delete on table push_tokens to service_role;

notify pgrst, 'reload schema';

-- ========================================================================
-- 0037_moderation_profil.sql
-- ========================================================================

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
