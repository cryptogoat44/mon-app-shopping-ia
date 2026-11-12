-- 0038 (mission « liens vidéo », 2026-11-12) : la mémoire collective des
-- vidéos. Quand un membre « spotte » une vidéo TikTok ou Instagram, les
-- pièces trouvées sont rattachées à cette vidéo ; le membre suivant qui
-- partage la même vidéo voit « Pièces déjà repérées dans cette vidéo ».
--
-- Retour en arrière (le serveur actuel fonctionne sans 0038 ; redémarrez-le
-- ensuite pour qu'il relise la base). Tout ce que la mémoire a noté est
-- alors perdu ; les recherches et leurs résultats ne sont pas touchés :
--   drop function if exists video_products(text, text, uuid, integer);
--   drop function if exists video_confirm(uuid, text, text, text, timestamptz);
--   drop function if exists video_spot_record(uuid, text, text, text, text, uuid, text, integer, jsonb, timestamptz);
--   drop function if exists video_memory_version();
--   drop table if exists video_item_confirmations, video_spot_items, video_spots, video_sources;
--   drop function if exists video_spots_after_delete();
--
-- Ce qu'elle garde, et rien d'autre (règle 5 de la mission) :
-- 1. video_sources : une vidéo = sa plateforme, sa clé (identifiant TikTok,
--    code Instagram), son adresse publique sans paramètre de suivi, le pseudo
--    du créateur s'il figurait dans l'adresse, et deux compteurs. JAMAIS
--    d'image, de miniature ni de fichier.
-- 2. video_spots : « ce membre a spotté cette vidéo avec cette recherche »
--    (la recherche existante, product_searches), d'où vient l'image
--    (lecteur, capture partagée, recherche d'image d'iOS…) et, si le lecteur
--    le donnait, le moment de la vidéo en secondes. Une recherche = un spot
--    au plus.
-- 3. video_spot_items : les pièces d'un spot. Aucune pièce n'est recopiée :
--    chaque ligne pointe vers un résultat existant (product_matches) et porte
--    sa clé « même page » (empreinte de l'adresse de la boutique nettoyée,
--    calculée par le serveur), qui sert à reconnaître la même pièce d'un spot
--    à l'autre.
-- 4. video_item_confirmations : « C'est bien cette pièce », une fois par
--    membre, par vidéo et par pièce.
--
-- Qui lit quoi : PERSONNE ne lit ces tables hors du serveur (sécurité par
-- ligne activée, aucun droit pour les clés publiques, comme les tables des
-- alertes de 0036 ; c'est plus strict que « chacun ne lit que ses lignes »).
-- Le serveur n'écrit un spot ou une confirmation que pour le membre connecté
-- (video_spot_record vérifie en plus que la recherche est bien la sienne).
-- La seule lecture montrée aux membres passe par video_products : les pièces
-- d'une vidéo, dédoublonnées, triées par confirmations, puis par nombre
-- d'apparitions, puis par récence — sans aucun identifiant de membre, de
-- spot ni de recherche. L'ordre ne dépend jamais d'une commission.
--
-- Durée de vie : un spot part avec sa recherche (supprimée au bout de
-- 12 mois, ou avec le compte) ; ses pièces et les compteurs de la vidéo
-- suivent. Une confirmation part avec le compte de son auteur.
--
-- Donnée modifiée : les adresses de miniature TikTok ou Instagram encore
-- notées sur d'anciennes recherches (product_searches.thumbnail_url, voie
-- « couverture » retirée) sont vidées. Ce n'étaient que des adresses, jamais
-- des fichiers ; plus rien ne les lit.
--
-- Facultative pour le serveur : sans elle, la mémoire répond « indisponible »
-- (sonde video_memory_version, lib/videoMemory.ts) et rien n'est noté. À
-- appliquer d'abord sur spotto-dev-2 (migrer-dev), puis sur spotto-prod.
-- Rejouable sans effet (if not exists, create or replace).

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'product_matches' and column_name = 'lens_rank') then
    raise exception 'Appliquez d''abord la migration 0031 (boutiques ensuite), puis relancez 0038.';
  end if;
end;
$$;

-- ---- Les vidéos ----
create table if not exists video_sources (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('tiktok', 'instagram')),
  video_key text not null check (video_key ~ '^[A-Za-z0-9_-]{5,64}$'),
  canonical_url text not null check (canonical_url ~ '^https://www\.(tiktok|instagram)\.com/' and char_length(canonical_url) <= 200),
  creator_handle text check (creator_handle is null or creator_handle ~ '^[a-z0-9._]{1,30}$'),
  created_at timestamptz not null default now(),
  last_spotted_at timestamptz,
  spot_count integer not null default 0 check (spot_count >= 0),
  unique (platform, video_key)
);
alter table video_sources enable row level security;

-- ---- Les spots ----
create table if not exists video_spots (
  id uuid primary key default gen_random_uuid(),
  video_source_id uuid not null references video_sources(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  search_id uuid not null unique references product_searches(id) on delete cascade,
  source text not null check (source in ('tiktok_player', 'instagram_player', 'share', 'visual_intelligence', 'app', 'web')),
  moment_seconds integer check (moment_seconds is null or moment_seconds between 0 and 86400),
  created_at timestamptz not null default now()
);
create index if not exists video_spots_source_idx on video_spots (video_source_id, created_at desc);
create index if not exists video_spots_user_idx on video_spots (user_id);
alter table video_spots enable row level security;

-- ---- Les pièces d'un spot (pointeurs vers les résultats existants) ----
create table if not exists video_spot_items (
  video_spot_id uuid not null references video_spots(id) on delete cascade,
  product_match_id uuid not null references product_matches(id) on delete cascade,
  video_source_id uuid not null references video_sources(id) on delete cascade,
  product_key text not null check (product_key ~ '^[0-9a-f]{64}$'),
  primary key (video_spot_id, product_match_id)
);
create index if not exists video_spot_items_source_key_idx on video_spot_items (video_source_id, product_key);
create index if not exists video_spot_items_match_idx on video_spot_items (product_match_id);
alter table video_spot_items enable row level security;

-- ---- « C'est bien cette pièce » ----
create table if not exists video_item_confirmations (
  user_id uuid not null references profiles(id) on delete cascade,
  video_source_id uuid not null references video_sources(id) on delete cascade,
  product_key text not null check (product_key ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key (user_id, video_source_id, product_key)
);
create index if not exists video_item_confirmations_source_key_idx on video_item_confirmations (video_source_id, product_key);
alter table video_item_confirmations enable row level security;

-- Aucune règle d'accès (policy) : avec la sécurité par ligne activée, cela
-- veut dire « personne », sauf le serveur (service_role).
revoke all on table video_sources, video_spots, video_spot_items, video_item_confirmations from public, anon, authenticated;
grant select, insert, update, delete on table video_sources, video_spots, video_spot_items, video_item_confirmations to service_role;

-- Un spot supprimé (recherche de plus de 12 mois, compte supprimé) : le
-- compteur de la vidéo suit, sans jamais passer sous zéro.
create or replace function video_spots_after_delete()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update video_sources set spot_count = greatest(spot_count - 1, 0) where id = old.video_source_id;
  return null;
end;
$$;
drop trigger if exists video_spots_after_delete on video_spots;
create trigger video_spots_after_delete after delete on video_spots
  for each row execute function video_spots_after_delete();

-- Sonde du serveur : la migration est-elle là ?
create or replace function video_memory_version()
returns integer
language sql
immutable
set search_path = public
as $$ select 1 $$;

-- Enregistre un spot : la vidéo est créée si elle est nouvelle, le spot est
-- noté une seule fois par recherche, ses pièces (10 au plus, dans l'ordre
-- donné) sont rattachées. p_items : [{"m": "<résultat>", "k": "<clé>"}, …] ;
-- seuls les résultats de CETTE recherche sont gardés.
-- Réponses : 'ok', 'already_recorded' (cette recherche a déjà son spot),
-- 'search_not_found' (la recherche n'est pas à ce membre), 'invalid'.
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
begin
  if p_user_id is null or p_search_id is null or p_platform is null or p_video_key is null or p_canonical_url is null
     or jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    return query select 'invalid'::text, 0;
    return;
  end if;
  if not exists (select 1 from product_searches s where s.id = p_search_id and s.user_id = p_user_id) then
    return query select 'search_not_found'::text, 0;
    return;
  end if;

  insert into video_sources (platform, video_key, canonical_url, creator_handle, created_at)
    values (p_platform, p_video_key, p_canonical_url, p_creator_handle, p_now)
    on conflict (platform, video_key) do update
      set creator_handle = coalesce(video_sources.creator_handle, excluded.creator_handle)
    returning id into v_source;

  insert into video_spots (video_source_id, user_id, search_id, source, moment_seconds, created_at)
    values (v_source, p_user_id, p_search_id, p_source, p_moment_seconds, p_now)
    on conflict (search_id) do nothing
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

-- « C'est bien cette pièce » : une fois par membre, par vidéo et par pièce.
-- La pièce doit déjà figurer parmi celles de la vidéo.
-- Réponses : 'ok', 'already_confirmed', 'unknown_video', 'unknown_product'.
create or replace function video_confirm(
  p_user_id uuid,
  p_platform text,
  p_video_key text,
  p_product_key text,
  p_now timestamptz default now()
)
returns table (outcome text)
language plpgsql
set search_path = public
as $$
declare
  v_source uuid;
  v_inserted integer;
begin
  select id into v_source from video_sources where platform = p_platform and video_key = p_video_key;
  if v_source is null then
    return query select 'unknown_video'::text;
    return;
  end if;
  if not exists (select 1 from video_spot_items i where i.video_source_id = v_source and i.product_key = p_product_key) then
    return query select 'unknown_product'::text;
    return;
  end if;
  insert into video_item_confirmations (user_id, video_source_id, product_key, created_at)
    values (p_user_id, v_source, p_product_key, p_now)
    on conflict do nothing;
  get diagnostics v_inserted = row_count;
  return query select case when v_inserted = 1 then 'ok' else 'already_confirmed' end;
end;
$$;

-- Les pièces d'une vidéo, pour tous les membres : une ligne par pièce (clé
-- « même page »), montrée avec son résultat le plus récent. Tri : nombre de
-- confirmations, puis nombre de spots où elle apparaît, puis récence. Aucun
-- identifiant de membre, de spot ni de recherche ne sort d'ici ;
-- `confirmed_by_viewer` ne parle que de la personne qui regarde.
-- Vidéo inconnue : aucune ligne.
create or replace function video_products(
  p_platform text,
  p_video_key text,
  p_viewer_id uuid,
  p_limit integer default 12
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
    select i.product_key, i.product_match_id, s.id as spot_id, s.created_at
    from video_spot_items i
    join video_spots s on s.id = i.video_spot_id
    where i.video_source_id = (select id from source)
  ),
  grouped as (
    select seen.product_key,
           count(distinct seen.spot_id)::integer as appearances,
           max(seen.created_at) as last_seen_at,
           (array_agg(seen.product_match_id order by seen.created_at desc, seen.product_match_id))[1] as product_match_id
    from seen
    group by seen.product_key
  ),
  confirmed as (
    select c.product_key,
           count(*)::integer as confirmations,
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

revoke all on function video_memory_version() from public, anon, authenticated;
grant execute on function video_memory_version() to service_role;
revoke all on function video_spot_record(uuid, text, text, text, text, uuid, text, integer, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function video_spot_record(uuid, text, text, text, text, uuid, text, integer, jsonb, timestamptz) to service_role;
revoke all on function video_confirm(uuid, text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function video_confirm(uuid, text, text, text, timestamptz) to service_role;
revoke all on function video_products(text, text, uuid, integer) from public, anon, authenticated;
grant execute on function video_products(text, text, uuid, integer) to service_role;
revoke all on function video_spots_after_delete() from public, anon, authenticated;

-- ---- Voie « couverture » retirée : plus aucune adresse de miniature gardée ----
update product_searches set thumbnail_url = null where thumbnail_url is not null;
