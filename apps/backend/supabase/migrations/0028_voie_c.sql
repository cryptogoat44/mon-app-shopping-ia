-- 0028 (lot c, voie C, 2026-11-02). Aucune donnée personnelle de plus liée au compte : search_cache n'a ni user_id ni search_id.
--
-- La voie C complète les résultats de Google Lens, sans jamais les remplacer :
-- « Cette pièce dans d'autres boutiques » (requête écrite par l'IA à partir des
-- titres Lens, puis Google Shopping) et « Que cherchez-vous ? » (voie B : une
-- recherche Google Shopping avec vos mots, sur la MÊME recherche, une fois).
-- Ce qu'il faut dans la base :
-- - l'origine de chaque proposition (Lens, boutiques, vos mots), pour que les
--   propositions du complément soient de vraies lignes (Garder, Je l'ai
--   achetée, Résultat incohérent, clics) et qu'une recherche rouverte montre
--   ses sections ;
-- - l'issue du complément, le budget de la photo (3 recherches au plus), le
--   verrou de la voie B et son invitation, qui survivent à un rechargement ;
-- - un cache de 24 h qui survit aux redémarrages de Render ;
-- - les recherches servies par le cache, hors de la part de 8 par personne.
--
-- Rejouable sans effet (if not exists). Le fondateur l'applique sur
-- spotto-dev-2 avec migrer-dev AVANT de mettre VOIE_C_ENABLED à "true".
-- L'ancien serveur fonctionne avec la base migrée : les nouvelles colonnes ont
-- des valeurs par défaut (origine 'lens', booléens faux, 0 appel), zod ignore
-- les colonnes qu'il ne connaît pas, et serpapi_quota garde ses paramètres et
-- ce qu'elle renvoie. Le nouveau serveur sur une base sans 0028 : la voie C
-- reste coupée (interrupteur coupé par défaut, et sonde du schéma).
--
-- Retour en arrière (docs/0028-retour.sql, sur le Mac), dans cet ordre :
-- 1. recréer serpapi_quota avec le corps exact de 0027, EN PREMIER ;
-- 2. drop table if exists search_cache ;
-- 3. retirer les nouvelles colonnes de product_searches et la contrainte ;
-- 4. retirer product_matches.origin.

-- ---- Origine de chaque proposition ----
-- 'lens' : la recherche visuelle ; 'shopping' : la même pièce dans d'autres
-- boutiques (requête de l'IA) ; 'words' : la recherche avec vos mots (voie B).
alter table product_matches
  add column if not exists origin text not null default 'lens' check (origin in ('lens', 'shopping', 'words'));

-- ---- Complément de chaque recherche ----
-- complement_status : issue du complément, vide quand la voie C n'a pas tourné
--   (shown, empty, no_query, ai_failed, shopping_failed, no_time, no_capacity,
--   skipped : étape IA coupée, error : exception inattendue) ;
-- shopping_calls : recherches Google Shopping réellement envoyées pour cette
--   photo (boutiques au plus 1, vos mots au plus 1) ; avec Lens (0 s'il vient
--   du cache, sinon 1), jamais plus de 3 recherches par photo ;
-- lens_from_cache : la réponse de Lens vient du cache (aucun appel Lens) ;
-- served_from_cache : aucune recherche réelle dans ce lancement (tout vient du
--   cache) : hors de la part de 8 par personne ;
-- text_suggested : proposer « Que cherchez-vous ? » (résultat peu fiable) ;
-- text_requested_at : heure de la recherche avec vos mots, une seule fois par
--   recherche (verrou) ; vos mots, eux, ne sont jamais enregistrés ;
-- text_status : issue de la recherche avec vos mots ;
-- total_seconds : durée du lancement, du formulaire reçu à l'enregistrement (mesure).
alter table product_searches
  add column if not exists complement_status text check (complement_status in ('shown','empty','no_query','ai_failed','shopping_failed','no_time','no_capacity','skipped','error')),
  add column if not exists shopping_calls smallint not null default 0 check (shopping_calls between 0 and 2),
  add column if not exists lens_from_cache boolean not null default false,
  add column if not exists served_from_cache boolean not null default false,
  add column if not exists text_suggested boolean not null default false,
  add column if not exists text_requested_at timestamptz,
  add column if not exists text_status text check (text_status in ('shown','empty','shopping_failed')),
  add column if not exists total_seconds smallint check (total_seconds between 0 and 600);

-- Servie par le cache sans aucun appel : la réponse de Lens vient forcément du cache.
alter table product_searches drop constraint if exists product_searches_served_from_cache_check;
alter table product_searches add constraint product_searches_served_from_cache_check check (not served_from_cache or lens_from_cache);

-- ---- Cache des recherches (24 h) ----
-- key : empreinte SHA-256 (64 caractères hexadécimaux) de l'étape et de ses
--   paramètres ; pour Lens, empreinte de l'image recadrée, jamais l'image ;
-- step : lens (réponse filtrée de Lens), query (requête écrite par l'IA, ou
--   son absence), shopping (réponse filtrée de Google Shopping, requêtes de
--   l'IA seulement : vos mots ne sont jamais mis en cache) ;
-- payload : 256 Ko au plus ; expires_at : 24 h après l'écriture.
-- Le serveur supprime les lignes expirées à chaque préparation de recherche,
-- même voie C coupée : la durée de 24 h borne la conservation.
create table if not exists search_cache (
  key text primary key check (key ~ '^[0-9a-f]{64}$'),
  step text not null check (step in ('lens','query','shopping')),
  payload jsonb not null check (octet_length(payload::text) <= 262144),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null check (expires_at > created_at)
);
create index if not exists search_cache_expires_at_idx on search_cache (expires_at);
alter table search_cache enable row level security;  -- aucune politique : serveur seul
revoke all on table search_cache from public, anon, authenticated;
grant select, insert, update, delete on table search_cache to service_role;

-- ---- serpapi_quota : les recherches servies par le cache hors de la part de la personne ----
-- Corps copié tel quel de 0027, mêmes paramètres, mêmes valeurs par défaut,
-- même type renvoyé (d'où « create or replace », sans suppression). Une seule
-- condition ajoutée, dans le compte de la part de la personne :
-- « and not s.served_from_cache ». La voie B n'est pas une nouvelle photo
-- (décision du fondateur) : elle n'ajoute rien à la part de 8, mais chaque
-- appel réel compte dans les plafonds du jour et du mois (serpapi_calls).
-- Une recherche servie par le cache qui lance la voie B fait un appel réel :
-- le serveur la retire alors des recherches « servies par le cache », et elle
-- compte comme une photo (sinon, une boucle relance + vos mots ne serait
-- jamais comptée).
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
      and s.failure_kind is distinct from 'provider_refused'
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
