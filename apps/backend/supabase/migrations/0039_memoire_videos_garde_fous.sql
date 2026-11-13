-- 0039 (revue de sécurité des liens vidéo, 2026-11-12) : garde-fous de la
-- mémoire collective des vidéos (0038). Sans eux, un seul compte pouvait
-- rattacher n'importe quelle recherche réussie à n'importe quelle vidéo, se
-- confirmer lui-même et passer devant les pièces honnêtes ; celui qui
-- envoyait le lien d'une vidéo confidentielle pouvait deviner qui l'avait
-- spottée ; et rien ne permettait de retirer une pièce.
--
-- Retour en arrière (vers 0038 seule : le serveur actuel coupe alors la
-- mémoire, « indisponible » ; redémarrez-le ensuite pour qu'il relise la
-- base). Les spots en double retirés par 0039 ne reviennent pas :
--   drop function if exists video_memory_remove(text, text, text);
--   drop function if exists video_products(text, text, uuid, integer, integer);
--   drop index if exists video_spots_source_user_key;
--   puis rejouez 0038 telle quelle (rejouable) : elle remet video_products
--   à 4 paramètres, l'ancienne video_spot_record et video_memory_version (1).
--
-- Ce qu'elle change :
-- 1. Un spot par membre et par vidéo (index unique video_spots_source_user_key).
--    Les doublons déjà notés sont retirés : le spot le plus récent de chaque
--    membre sur chaque vidéo est gardé (ses pièces avec lui), le compteur de
--    la vidéo suit (déclencheur de 0038).
-- 2. video_spot_record :
--    - « already_recorded » AVANT toute écriture quand la recherche a déjà
--      son spot (0038 créait d'abord la vidéo : des identifiants inventés
--      remplissaient video_sources sans fin), ou quand le membre a déjà un
--      spot sur cette vidéo ;
--    - « search_too_old » pour une recherche créée plus de 30 minutes avant
--      p_now (l'app note le spot juste après les résultats).
-- 3. video_products (nouveau paramètre p_min_members, 2 par défaut ; le
--    serveur passe VIDEO_MEMORY_MIN_MEMBERS, lib/videoMemory.ts) :
--    - une pièce n'est montrée qu'une fois trouvée par au moins p_min_members
--      membres DISTINCTS ;
--    - `appearances` = nombre de membres distincts (plus le nombre de spots) ;
--    - une confirmation ne compte que si son auteur n'a pas lui-même apporté
--      cette pièce dans un de ses spots ;
--    - les spots et les confirmations des comptes suspendus (table
--      suspensions, 0023) sont écartés tant que la suspension dure.
--    Même ordre qu'avant : confirmations, puis apparitions, puis récence ;
--    `confirmed_by_viewer` dit toujours si la personne qui regarde a confirmé.
--    L'ancienne signature (4 paramètres) est retirée : une seule fonction.
-- 4. video_memory_remove (modération) : retire une pièce d'une vidéo, ses
--    rattachements à tous les spots de cette vidéo et ses confirmations. Les
--    recherches des membres ne sont pas touchées. Un nouveau spot qui
--    retrouverait la même page la ferait revenir (seuil de membres compris).
-- 5. video_memory_version rend 2 : le serveur ne sert la mémoire qu'avec 0039.
--
-- Qui lit quoi : rien ne change, PERSONNE hors du serveur (service_role). Les
-- fonctions nouvelles ou remplacées n'appartiennent qu'à service_role.
--
-- À appliquer après 0038 (refusée sans elle), d'abord sur spotto-dev-2
-- (migrer-dev), puis sur spotto-prod. Rejouable sans effet (if not exists,
-- create or replace, drop if exists).

do $$
begin
  if to_regclass('public.video_spots') is null or to_regprocedure('public.video_memory_version()') is null then
    raise exception 'Appliquez d''abord la migration 0038 (mémoire des vidéos), puis relancez 0039.';
  end if;
end;
$$;

-- ---- 1. Un spot par membre et par vidéo ----
-- Doublons notés sous 0038 : le plus récent est gardé (date, puis identifiant).
delete from video_spots s
  using video_spots newer
  where newer.video_source_id = s.video_source_id
    and newer.user_id = s.user_id
    and (newer.created_at > s.created_at or (newer.created_at = s.created_at and newer.id > s.id));
create unique index if not exists video_spots_source_user_key on video_spots (video_source_id, user_id);

-- ---- 5. Sonde du serveur : les garde-fous sont là ----
create or replace function video_memory_version()
returns integer
language sql
immutable
set search_path = public
as $$ select 2 $$;

-- ---- 2. Enregistrer un spot ----
-- Réponses : 'ok', 'already_recorded' (cette recherche a déjà son spot, ou
-- ce membre en a déjà un sur cette vidéo), 'search_not_found' (la recherche
-- n'est pas à ce membre), 'search_too_old' (créée plus de 30 minutes avant
-- p_now), 'invalid'. Aucune écriture avant ces contrôles.
create or replace function video_spot_record(
  p_user_id uuid,
  p_platform text,
  p_video_key text,
  p_canonical_url text,
  p_creator_handle text,
  p_search_id uuid,
  p_source text,
  p_moment_seconds integer,
  p_items jsonb,
  p_now timestamptz default now()
)
returns table (outcome text, items integer)
language plpgsql
set search_path = public
as $$
declare
  v_source uuid;
  v_spot uuid;
  v_items integer := 0;
  v_search_created timestamptz;
begin
  if p_user_id is null or p_search_id is null or p_platform is null or p_video_key is null or p_canonical_url is null
     or jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    return query select 'invalid'::text, 0;
    return;
  end if;
  select s.created_at into v_search_created from product_searches s where s.id = p_search_id and s.user_id = p_user_id;
  if not found then
    return query select 'search_not_found'::text, 0;
    return;
  end if;
  -- Recherche déjà notée : rien n'est écrit, pas même la vidéo.
  if exists (select 1 from video_spots where search_id = p_search_id) then
    return query select 'already_recorded'::text, 0;
    return;
  end if;
  if v_search_created < coalesce(p_now, now()) - interval '30 minutes' then
    return query select 'search_too_old'::text, 0;
    return;
  end if;
  -- Un spot par membre et par vidéo.
  select id into v_source from video_sources where platform = p_platform and video_key = p_video_key;
  if v_source is not null and exists (select 1 from video_spots where video_source_id = v_source and user_id = p_user_id) then
    return query select 'already_recorded'::text, 0;
    return;
  end if;

  insert into video_sources (platform, video_key, canonical_url, creator_handle, created_at)
    values (p_platform, p_video_key, p_canonical_url, p_creator_handle, p_now)
    on conflict (platform, video_key) do update
      set creator_handle = coalesce(video_sources.creator_handle, excluded.creator_handle)
    returning id into v_source;

  -- Sans cible : ni la même recherche, ni un 2ᵉ spot du membre (appels simultanés).
  insert into video_spots (video_source_id, user_id, search_id, source, moment_seconds, created_at)
    values (v_source, p_user_id, p_search_id, p_source, p_moment_seconds, p_now)
    on conflict do nothing
    returning id into v_spot;
  if v_spot is null then
    return query select 'already_recorded'::text, 0;
    return;
  end if;

  insert into video_spot_items (video_spot_id, product_match_id, video_source_id, product_key)
    select v_spot, m.id, v_source, wanted.k
    from (
      -- Une ligne par résultat (le premier donné), identifiant mal formé écarté sans erreur.
      select distinct on (item.m) item.m, item.k, item.ord
      from (
        select case when e.value->>'m' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then (e.value->>'m')::uuid end as m,
               e.value->>'k' as k,
               e.ord
        from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) with ordinality as e(value, ord)
      ) item
      where item.m is not null and item.k ~ '^[0-9a-f]{64}$'
      order by item.m, item.ord
    ) wanted
    join product_matches m on m.id = wanted.m and m.search_id = p_search_id
    order by wanted.ord
    limit 10;
  get diagnostics v_items = row_count;

  update video_sources set spot_count = spot_count + 1, last_spotted_at = p_now where id = v_source;
  return query select 'ok'::text, v_items;
end;
$$;

-- ---- 3. Les pièces d'une vidéo ----
-- Une ligne par pièce (clé « même page ») trouvée par au moins p_min_members
-- membres distincts, comptes suspendus écartés, montrée avec son résultat le
-- plus récent. Tri : confirmations (d'autres membres que ceux qui l'ont
-- apportée), puis nombre de membres, puis récence. Aucun identifiant de
-- membre, de spot ni de recherche ne sort d'ici ; `confirmed_by_viewer` ne
-- parle que de la personne qui regarde. Vidéo inconnue : aucune ligne.
drop function if exists video_products(text, text, uuid, integer);
create or replace function video_products(
  p_platform text,
  p_video_key text,
  p_viewer_id uuid,
  p_limit integer default 12,
  p_min_members integer default 2
)
returns table (
  product_key text,
  product_match_id uuid,
  product_name text,
  brand text,
  image_url text,
  image_hd_url text,
  price_min numeric,
  currency text,
  merchant_name text,
  merchant_url text,
  confirmations integer,
  appearances integer,
  last_seen_at timestamptz,
  confirmed_by_viewer boolean
)
language sql
stable
set search_path = public
as $$
  with source as (
    select id from video_sources where platform = p_platform and video_key = p_video_key
  ),
  seen as (
    select i.product_key, i.product_match_id, s.user_id, s.created_at
    from video_spot_items i
    join video_spots s on s.id = i.video_spot_id
    where i.video_source_id = (select id from source)
      and not exists (select 1 from suspensions x where x.user_id = s.user_id)
  ),
  grouped as (
    select seen.product_key,
           count(distinct seen.user_id)::integer as appearances,
           max(seen.created_at) as last_seen_at,
           (array_agg(seen.product_match_id order by seen.created_at desc, seen.product_match_id))[1] as product_match_id
    from seen
    group by seen.product_key
    having count(distinct seen.user_id) >= greatest(1, coalesce(p_min_members, 2))
  ),
  confirmed as (
    select c.product_key,
           (count(*) filter (
              where not exists (select 1 from suspensions x where x.user_id = c.user_id)
                and not exists (select 1 from seen own where own.product_key = c.product_key and own.user_id = c.user_id)
           ))::integer as confirmations,
           bool_or(c.user_id = p_viewer_id) as confirmed_by_viewer
    from video_item_confirmations c
    where c.video_source_id = (select id from source)
    group by c.product_key
  )
  select g.product_key,
         m.id,
         m.product_name,
         m.brand,
         m.image_url,
         m.image_hd_url,
         m.price_min,
         m.currency::text,
         m.merchant_name,
         m.merchant_url,
         coalesce(c.confirmations, 0),
         g.appearances,
         g.last_seen_at,
         coalesce(c.confirmed_by_viewer, false)
  from grouped g
  join product_matches m on m.id = g.product_match_id
  left join confirmed c on c.product_key = g.product_key
  order by coalesce(c.confirmations, 0) desc, g.appearances desc, g.last_seen_at desc, g.product_key
  limit greatest(1, least(coalesce(p_limit, 12), 50));
$$;

-- ---- 4. Modération : retirer une pièce d'une vidéo ----
-- Réponses : 'ok' (avec le nombre de rattachements et de confirmations
-- retirés), 'unknown_video', 'unknown_product' (rien à retirer).
create or replace function video_memory_remove(
  p_platform text,
  p_video_key text,
  p_product_key text
)
returns table (outcome text, items integer, confirmations integer)
language plpgsql
set search_path = public
as $$
declare
  v_source uuid;
  v_items integer := 0;
  v_confirmations integer := 0;
begin
  select id into v_source from video_sources where platform = p_platform and video_key = p_video_key;
  if v_source is null then
    return query select 'unknown_video'::text, 0, 0;
    return;
  end if;
  delete from video_spot_items i where i.video_source_id = v_source and i.product_key = p_product_key;
  get diagnostics v_items = row_count;
  delete from video_item_confirmations c where c.video_source_id = v_source and c.product_key = p_product_key;
  get diagnostics v_confirmations = row_count;
  if v_items = 0 and v_confirmations = 0 then
    return query select 'unknown_product'::text, 0, 0;
    return;
  end if;
  return query select 'ok'::text, v_items, v_confirmations;
end;
$$;

revoke all on function video_memory_version() from public, anon, authenticated;
grant execute on function video_memory_version() to service_role;
revoke all on function video_spot_record(uuid, text, text, text, text, uuid, text, integer, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function video_spot_record(uuid, text, text, text, text, uuid, text, integer, jsonb, timestamptz) to service_role;
revoke all on function video_products(text, text, uuid, integer, integer) from public, anon, authenticated;
grant execute on function video_products(text, text, uuid, integer, integer) to service_role;
revoke all on function video_memory_remove(text, text, text) from public, anon, authenticated;
grant execute on function video_memory_remove(text, text, text) to service_role;

-- ---- Suppression d'un compte qui a spotté une vidéo ----
-- Le déclencheur du compteur (0038) doit s'exécuter avec les droits de son
-- propriétaire : sinon le système de comptes de Supabase ne peut plus
-- supprimer un membre qui a un spot (« Database error deleting user »,
-- constaté sur spotto-dev-2 le 13 novembre 2026). 0038 le déclare désormais
-- elle-même ; répété ici pour une base où l'ancienne 0038 est déjà appliquée.
alter function video_spots_after_delete() security definer;
alter function video_spots_after_delete() set search_path = public;
