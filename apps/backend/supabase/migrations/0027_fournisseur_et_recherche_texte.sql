-- 0027 (décisions du fondateur du 25 octobre 2026) : une seule migration pour
-- trois mises en ligne (docs/0027-conception-2026-10-25.md, section 8) :
-- 1. les fondations : l'interface du fournisseur, la place rendue quand le
--    fournisseur refuse, la recherche interrompue, les disjoncteurs ;
-- 2. les messages de panne (rien de plus dans la base) ;
-- 3. la recherche par texte et « Voir les boutiques ».
-- Aucune nouvelle table, aucune donnée personnelle de plus.
--
-- L'ancien serveur fonctionne avec la base migrée : il ignore le numéro de
-- place renvoyé en plus par serpapi_quota, n'appelle jamais serpapi_release
-- et écrit encore 'serpapi_error', valeur qui reste donc acceptée.
-- Retour en arrière : docs/0027-retour.sql, seulement avant la mise en ligne 3.
-- Postgres ne sait pas retirer une valeur ajoutée à un type énuméré : 'text'
-- resterait, inutilisée.

-- ---- Recherche par texte (mise en ligne 3) ----
-- Utilisables seulement après la fin de cette transaction (règle de Postgres) :
-- rien ci-dessous ne s'en sert.
alter type recognition_method add value if not exists 'text';
alter type platform_source add value if not exists 'text';

-- ---- Fournisseur, code de réponse, heure du lancement ----
-- provider : nom du fournisseur ('serpapi' aujourd'hui), vérifié par son
-- format et non par une liste : un autre fournisseur ne demandera pas de
-- migration. Vide pour les recherches d'avant : on n'invente pas le passé.
-- provider_status_code : code de réponse du fournisseur (200, 400, 429…),
-- vide sans réponse (délai dépassé, réseau coupé).
-- run_started_at : heure du lancement (passage à « en cours »), remise à vide
-- si aucun appel n'est finalement parti ; sert à la recherche interrompue et
-- aux disjoncteurs (d'où l'index).
alter table product_searches
  add column if not exists provider text check (provider ~ '^[a-z][a-z0-9_]{0,31}$'),
  add column if not exists provider_status_code smallint check (provider_status_code between 100 and 599),
  add column if not exists run_started_at timestamptz;
create index if not exists product_searches_run_started_at_idx on product_searches (run_started_at);

-- ---- Causes d'échec et issues de la mesure ----
-- provider_refused : refus annoncé par le fournisseur (code 400 à 499, 500 ou
--   503, ou statut « Error »), non facturé ; sa place a été rendue dans les
--   trois plafonds. Si elle n'a pas pu l'être, la recherche est notée
--   provider_error et reste comptée (prudence).
-- provider_error : remplace serpapi_error (réseau coupé, statut absent, autre
--   erreur) ; les lignes existantes sont converties.
-- interrupted : restée « en cours » plus de 2 minutes, marquée à sa relecture.
-- empty_text : recherche par texte sans aucune pièce (mise en ligne 3).
-- Noms des contraintes lus sur spotto-dev le 25 octobre (créées par 0025) ;
-- sans « if exists » : un autre nom arrêterait la migration entière, sans rien changer.
alter table product_searches drop constraint product_searches_failure_kind_check;
update product_searches set failure_kind = 'provider_error' where failure_kind = 'serpapi_error';
alter table product_searches add constraint product_searches_failure_kind_check
  check (failure_kind in ('timeout', 'serpapi_error', 'provider_error', 'provider_refused', 'unreadable_response', 'save_failed', 'interrupted'));
alter table product_searches drop constraint product_searches_outcome_check;
alter table product_searches add constraint product_searches_outcome_check
  check (outcome in ('found', 'nothing_buyable', 'empty_lens', 'empty_text', 'failure'));

-- ---- Place rendue ----
-- La table ne garde toujours que des dates : « réservée le » et « rendue le ».
alter table serpapi_calls add column if not exists released_at timestamptz;
alter table serpapi_calls drop constraint if exists serpapi_calls_released_at_check;
alter table serpapi_calls add constraint serpapi_calls_released_at_check check (released_at >= called_at);

-- ---- « Voir les boutiques » (mise en ligne 3) ----
-- Rangés avec la pièce proposée, donc exportés et effacés avec elle.
-- provider_page_token, provider_product_id : références de la pièce chez le
-- fournisseur, pour lui demander ses boutiques ; stores : les boutiques
-- (20 au plus) ; stores_requested_at : heure de la demande, comptée dans la
-- part de la personne pour la journée.
alter table product_matches
  add column if not exists provider_page_token text check (char_length(provider_page_token) <= 2048),
  add column if not exists provider_product_id text check (char_length(provider_product_id) <= 256),
  add column if not exists stores jsonb check (stores is null or case when jsonb_typeof(stores) = 'array' then jsonb_array_length(stores) <= 20 else false end),
  add column if not exists stores_requested_at timestamptz;
create index if not exists product_matches_stores_requested_at_idx on product_matches (stores_requested_at) where stores_requested_at is not null;

-- ---- serpapi_quota : numéro de place, places rendues, part de la personne ----
-- Même rôle et mêmes paramètres qu'en 0022. Ce qui change :
-- - elle renvoie le numéro de la place réservée (reservation_id, vide sans réservation) ;
-- - les compteurs du jour et du cycle ignorent les places rendues ;
-- - la part de la personne ignore ses recherches refusées par le fournisseur
--   (place rendue), et compte ses « Voir les boutiques » du jour.
-- Le type de ce qu'elle renvoie change : il faut la supprimer, puis la recréer.
drop function if exists serpapi_quota(integer, integer, integer, integer, uuid, boolean, uuid, timestamptz);
create function serpapi_quota(
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
      and s.failure_kind is distinct from 'provider_refused';

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

-- ---- serpapi_release : rend une place, une seule fois ----
-- Appelée par le serveur quand le fournisseur a refusé la recherche (non
-- facturée), avec le numéro reçu de serpapi_quota pour CETTE recherche.
-- Rend la place une seule fois, et seulement une place réservée dans l'heure
-- (jamais une place amorcée en début de cycle, ni une ancienne). true : rendue
-- à l'instant ; false : inconnue, déjà rendue ou trop ancienne.
-- p_at : un instant fixé, pour les tests seulement ; le serveur ne le donne jamais.
create or replace function serpapi_release(p_id bigint, p_at timestamptz default null)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_at timestamptz;
begin
  if p_id is null then
    raise exception 'serpapi_release : paramètre invalide';
  end if;
  perform pg_advisory_xact_lock(hashtext('serpapi_quota'));
  v_at := coalesce(p_at, clock_timestamp());
  update serpapi_calls
    set released_at = v_at
    where id = p_id
      and released_at is null
      and called_at <= v_at and called_at > v_at - interval '1 hour';
  return found;
end;
$$;

-- Le serveur seul : ni les visiteurs, ni les comptes connectés.
revoke all on function serpapi_quota(integer, integer, integer, integer, uuid, boolean, uuid, timestamptz) from public, anon, authenticated;
grant execute on function serpapi_quota(integer, integer, integer, integer, uuid, boolean, uuid, timestamptz) to service_role;
revoke all on function serpapi_release(bigint, timestamptz) from public, anon, authenticated;
grant execute on function serpapi_release(bigint, timestamptz) to service_role;

notify pgrst, 'reload schema';
