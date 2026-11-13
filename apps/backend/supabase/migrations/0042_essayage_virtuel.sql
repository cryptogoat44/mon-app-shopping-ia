-- 0042 (lot « essayage virtuel », 2026-11-13) : l'essayage virtuel photo
-- (fournisseur FASHN), ÉTEINT par défaut. Le membre envoie une photo de lui,
-- choisit une pièce trouvée par l'app, et reçoit une image où il la porte.
-- La base ne garde que des métadonnées : jamais la photo, jamais l'image
-- produite, jamais la date de naissance (seulement « majeur » ou « mineur »).
--
-- Retour en arrière (après avoir coupé l'essayage : TRYON_ENABLED chez Render
-- et le drapeau ; sont alors perdus : les statuts d'âge, les consentements,
-- l'historique des essais, les essais offerts, les signalements, les alertes
-- et les compteurs du budget ; feature_flags seulement si aucune autre
-- fonction ne s'en sert) :
--   drop function if exists tryon_version();
--   drop function if exists tryon_remaining(uuid, integer, text, timestamptz);
--   drop function if exists tryon_reserve(uuid, uuid, text, integer, numeric, numeric, integer, integer, text, timestamptz);
--   drop function if exists tryon_complete(uuid, uuid, integer, integer, integer, numeric, numeric, numeric, text, timestamptz);
--   drop function if exists tryon_fail(uuid, uuid, text, integer);
--   drop function if exists tryon_set_age(uuid, text);
--   drop function if exists tryon_reset_age(uuid);
--   drop function if exists tryon_grant_bonus(uuid, text, integer, integer);
--   drop function if exists tryon_alert_once(text, text, jsonb);
--   drop function if exists tryon_purge(integer);
--   drop table if exists tryon_events, tryon_bonus_grants, tryon_reports, tryon_alerts, tryon_usage_months, tryon_profiles;
--   drop table if exists feature_flags;
--
-- Ce qu'elle ajoute :
-- 1. feature_flags : une ligne par fonction qu'on peut couper sans mise en
--    ligne. La ligne « tryon » est créée à false ; rejouer la migration ne
--    change jamais une valeur existante (on conflict do nothing). Seul le
--    script du fondateur l'allume (pnpm tryon:flag --on --confirm).
-- 2. tryon_profiles : un par membre. Statut d'âge (« adult » ou « minor »)
--    et sa date, jamais la date de naissance ; posé une seule fois
--    (tryon_set_age), seul un script d'administration le remet à zéro
--    (tryon_reset_age). Consentement : version acceptée, date d'acceptation,
--    date de retrait.
-- 3. tryon_events : un par essai. La pièce (identifiant du résultat de
--    recherche, sans clé étrangère : le résultat peut être purgé avant
--    l'essai), l'état (en cours, réussi, échoué), les crédits consommés, la
--    source du quota (gratuit ou offert, et l'essai offert utilisé), un code
--    d'erreur court (jamais un texte du fournisseur), la durée, le mois de
--    l'essai (heure de Paris) et ses dates. Aucune image, rien de tiré de la
--    photo. Effacés au bout de 12 mois (tryon_purge).
-- 4. tryon_bonus_grants : les essais offerts (5 par achat confirmé, 365
--    jours) : la référence de la commande, unique (accorder deux fois la même
--    commande ne fait rien), la quantité, le reste et l'expiration.
-- 5. tryon_reports : les signalements d'un résultat (motif, précision
--    facultative de 500 caractères au plus), sans aucune image.
-- 6. tryon_alerts : les alertes du budget (80 % et 100 % du mois) et du
--    solde de crédits bas, une seule par période ; jamais de donnée
--    personnelle dans leurs détails.
-- 7. tryon_usage_months : crédits consommés et essais réussis par mois, SANS
--    membre : le budget du mois reste juste même après la suppression d'un
--    compte (ses essais partent avec lui).
-- 8. Les fonctions du serveur (lui seul peut les appeler) : tryon_reserve
--    (réserve un essai : quota, un seul essai en cours par membre, essais en
--    cours du service, budget), tryon_complete (essai réussi : décompte,
--    gratuit d'abord, puis l'offert qui expire le plus tôt ; compteurs et
--    alertes du budget), tryon_fail (essai échoué, rien n'est décompté),
--    tryon_remaining (essais restants), tryon_set_age, tryon_reset_age,
--    tryon_grant_bonus, tryon_alert_once, tryon_purge et tryon_version
--    (sonde du serveur).
--    Verrous, toujours dans le même ordre (aucun interblocage) : la ligne
--    tryon_profiles du membre (ses essais passent un par un), puis le verrou
--    consultatif commun « tryon_budget », puis les lignes d'essai et d'essais
--    offerts. L'heure de référence est lue APRÈS les verrous ; p_at : un
--    instant fixé, pour les tests seulement (jamais donné par le serveur ;
--    sans purge).
--
-- Facultative pour le serveur : sans elle, l'essayage reste éteint (drapeau
-- introuvable : éteint ; sonde tryon_version, lib/tryon/schema.ts).
-- L'essayage reste aussi éteint tant que TRYON_ENABLED ne vaut pas « true »
-- chez Render ET que feature_flags.tryon ne vaut pas true.
-- À appliquer d'abord sur spotto-dev-2 (migrer-dev), puis sur spotto-prod
-- après validation. Rejouable sans effet (if not exists, create or replace,
-- on conflict do nothing) ; ne supprime ni ne modifie aucune donnée existante.
-- Aucune règle d'accès public : seul le serveur, avec sa clé secrète, lit et
-- écrit ces tables (RLS active, aucune politique).
-- Aucun déclencheur : la suppression d'un compte (rôle supabase_auth_admin,
-- sans droit sur ces tables) ne fait que des suppressions en cascade.

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception '0042 demande la table profiles (migration 0001) : appliquez d''abord les migrations précédentes.';
  end if;
end;
$$;

-- ---- 1. Drapeaux des fonctions ----
create table if not exists feature_flags (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);
-- Créé éteint ; une valeur existante n'est jamais changée par la migration.
insert into feature_flags (key, enabled) values ('tryon', false) on conflict (key) do nothing;
alter table feature_flags enable row level security;
revoke all on table feature_flags from public, anon, authenticated;
grant select, insert, update, delete on table feature_flags to service_role;

-- ---- 2. Profil d'essayage : statut d'âge et consentement ----
create table if not exists tryon_profiles (
  user_id uuid primary key references profiles(id) on delete cascade,
  age_status text check (age_status in ('adult', 'minor')),
  age_checked_at timestamptz,
  consent_version text check (consent_version is null or char_length(consent_version) between 1 and 40),
  consent_accepted_at timestamptz,
  consent_withdrawn_at timestamptz,
  check ((age_status is null) = (age_checked_at is null))
);
alter table tryon_profiles enable row level security;
revoke all on table tryon_profiles from public, anon, authenticated;
grant select, insert, update, delete on table tryon_profiles to service_role;

-- ---- 4. Essais offerts (avant les essais, qui les désignent) ----
create table if not exists tryon_bonus_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  order_ref text not null unique check (char_length(order_ref) between 1 and 200),
  quantity integer not null check (quantity between 1 and 100),
  remaining integer not null check (remaining >= 0 and remaining <= quantity),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
-- Les essais offerts d'un membre, dans l'ordre où ils expirent ; la purge.
create index if not exists tryon_bonus_grants_user_idx on tryon_bonus_grants (user_id, expires_at);
create index if not exists tryon_bonus_grants_expires_idx on tryon_bonus_grants (expires_at);
alter table tryon_bonus_grants enable row level security;
revoke all on table tryon_bonus_grants from public, anon, authenticated;
grant select, insert, update, delete on table tryon_bonus_grants to service_role;

-- ---- 3. Essais ----
create table if not exists tryon_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  item_id uuid not null,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  credits_used integer not null default 0 check (credits_used between 0 and 10),
  quota_source text check (quota_source in ('free', 'bonus')),
  bonus_grant_id uuid references tryon_bonus_grants(id) on delete set null,
  error_code text check (error_code is null or error_code ~ '^[a-z][a-z0-9_]{0,39}$'),
  duration_ms integer check (duration_ms is null or duration_ms between 0 and 600000),
  month text not null check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  check ((status = 'pending') = (finished_at is null)),
  check (status = 'succeeded' or (quota_source is null and credits_used = 0)),
  check (quota_source = 'bonus' or bonus_grant_id is null)
);
-- Un seul essai en cours par membre, et les essais en cours du service.
create index if not exists tryon_events_pending_user_idx on tryon_events (user_id) where status = 'pending';
create index if not exists tryon_events_pending_idx on tryon_events (created_at) where status = 'pending';
-- Essais gratuits réussis d'un membre dans le mois.
create index if not exists tryon_events_free_idx on tryon_events (user_id, month) where status = 'succeeded' and quota_source = 'free';
-- Export, suppression d'un compte, purge, rapport du mois.
create index if not exists tryon_events_user_idx on tryon_events (user_id, created_at);
create index if not exists tryon_events_created_idx on tryon_events (created_at);
create index if not exists tryon_events_month_idx on tryon_events (month);
create index if not exists tryon_events_bonus_grant_idx on tryon_events (bonus_grant_id) where bonus_grant_id is not null;
alter table tryon_events enable row level security;
revoke all on table tryon_events from public, anon, authenticated;
grant select, insert, update, delete on table tryon_events to service_role;

-- ---- 5. Signalements d'un résultat (sans image) ----
create table if not exists tryon_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  item_id uuid not null,
  reason text not null check (reason in ('inappropriate', 'wrong_piece', 'poor_quality', 'other')),
  comment text check (comment is null or char_length(comment) between 1 and 500),
  created_at timestamptz not null default now()
);
create index if not exists tryon_reports_user_idx on tryon_reports (user_id, created_at);
create index if not exists tryon_reports_created_idx on tryon_reports (created_at);
alter table tryon_reports enable row level security;
revoke all on table tryon_reports from public, anon, authenticated;
grant select, insert, update, delete on table tryon_reports to service_role;

-- ---- 6. Alertes (une par sorte et par période ; aucune donnée personnelle) ----
create table if not exists tryon_alerts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('budget_80', 'budget_100', 'low_credits')),
  period text not null check (period ~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$'),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now(),
  unique (kind, period)
);
create index if not exists tryon_alerts_created_idx on tryon_alerts (created_at);
alter table tryon_alerts enable row level security;
revoke all on table tryon_alerts from public, anon, authenticated;
grant select, insert, update, delete on table tryon_alerts to service_role;

-- ---- 7. Compteurs du budget, par mois, sans membre ----
create table if not exists tryon_usage_months (
  month text primary key check (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  credits_used integer not null default 0 check (credits_used >= 0),
  tries_succeeded integer not null default 0 check (tries_succeeded >= 0),
  updated_at timestamptz not null default now()
);
alter table tryon_usage_months enable row level security;
revoke all on table tryon_usage_months from public, anon, authenticated;
grant select, insert, update, delete on table tryon_usage_months to service_role;

-- ---- 8. Fonctions du serveur ----

-- Sonde du serveur : la migration est-elle là ?
create or replace function tryon_version()
returns integer
language plpgsql
stable
set search_path = public
as $$
begin
  return 1;
end;
$$;

-- Purge (minimisation) : essais, signalements et alertes de plus de
-- p_months mois, essais offerts expirés depuis plus de p_months mois.
-- Appelée par le serveur à chaque réservation (sans rien à effacer, quatre
-- lectures d'index), et par pnpm tryon:purge.
create or replace function tryon_purge(p_months integer default 12)
returns table (events integer, reports integer, alerts integer, grants integer)
language plpgsql
set search_path = public
as $$
declare
  v_cutoff timestamptz;
  v_events integer;
  v_reports integer;
  v_alerts integer;
  v_grants integer;
begin
  if p_months is null or p_months < 1 or p_months > 120 then
    raise exception 'tryon_purge : paramètres invalides';
  end if;
  v_cutoff := clock_timestamp() - make_interval(months => p_months);
  delete from tryon_events e where e.created_at < v_cutoff;
  get diagnostics v_events = row_count;
  delete from tryon_reports r where r.created_at < v_cutoff;
  get diagnostics v_reports = row_count;
  delete from tryon_alerts a where a.created_at < v_cutoff;
  get diagnostics v_alerts = row_count;
  delete from tryon_bonus_grants g where g.expires_at < v_cutoff;
  get diagnostics v_grants = row_count;
  return query select v_events, v_reports, v_alerts, v_grants;
end;
$$;

-- Une alerte (budget_80, budget_100, low_credits) une seule fois par période
-- (« AAAA-MM » ou « AAAA-MM-JJ ») ; true si elle vient d'être enregistrée.
create or replace function tryon_alert_once(p_kind text, p_period text, p_details jsonb)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  if p_kind is null or p_kind not in ('budget_80', 'budget_100', 'low_credits')
     or p_period is null or p_period !~ '^[0-9]{4}-[0-9]{2}(-[0-9]{2})?$'
     or p_details is null or jsonb_typeof(p_details) <> 'object' then
    raise exception 'tryon_alert_once : paramètres invalides';
  end if;
  insert into tryon_alerts (kind, period, details) values (p_kind, p_period, p_details)
    on conflict (kind, period) do nothing;
  return found;
end;
$$;

-- Essais restants d'un membre : gratuits du mois civil (fuseau p_timezone)
-- et offerts encore valables. Simple lecture.
create or replace function tryon_remaining(
  p_user_id uuid,
  p_free_per_month integer,
  p_timezone text,
  p_at timestamptz default null
)
returns table (free_remaining integer, bonus_remaining integer)
language plpgsql
stable
set search_path = public
as $$
declare
  v_at timestamptz := coalesce(p_at, now());
  v_month text;
  v_free_used integer;
  v_bonus integer;
begin
  if p_user_id is null or p_free_per_month is null or p_free_per_month < 0
     or p_timezone is null or p_timezone !~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$' then
    raise exception 'tryon_remaining : paramètres invalides';
  end if;
  v_month := to_char(v_at at time zone p_timezone, 'YYYY-MM');
  select count(*) into v_free_used from tryon_events e
    where e.user_id = p_user_id and e.status = 'succeeded' and e.quota_source = 'free' and e.month = v_month;
  select coalesce(sum(g.remaining), 0) into v_bonus from tryon_bonus_grants g
    where g.user_id = p_user_id and g.remaining > 0 and g.expires_at > v_at;
  return query select greatest(p_free_per_month - v_free_used, 0), v_bonus;
end;
$$;

-- Réserve un essai, juste avant l'appel au fournisseur. status :
-- « reserved » (event_id : l'essai en cours), ou la raison du refus, dans cet
-- ordre : not_allowed (pas majeur, ou consentement absent, retiré ou d'une
-- autre version), in_progress (un essai déjà en cours pour ce membre),
-- quota_exhausted (ni essai gratuit ce mois-ci, ni essai offert valable),
-- busy (p_max_in_flight essais en cours sur tout le service), budget_reached
-- (dépense du mois + essais en cours et celui-ci, au prix d'un essai,
-- au-delà du budget). Un essai en cours depuis plus de 3 minutes a échoué
-- (« expired ») : il est libéré ici. free_remaining et bonus_remaining :
-- les essais restants AVANT celui-ci.
create or replace function tryon_reserve(
  p_user_id uuid,
  p_item_id uuid,
  p_consent_version text,
  p_free_per_month integer,
  p_budget_usd numeric,
  p_price_per_credit_usd numeric,
  p_credits_per_try integer,
  p_max_in_flight integer,
  p_timezone text,
  p_at timestamptz default null
)
returns table (status text, event_id uuid, free_remaining integer, bonus_remaining integer)
language plpgsql
set search_path = public
as $$
#variable_conflict use_column
declare
  v_profile tryon_profiles%rowtype;
  v_has_profile boolean;
  v_at timestamptz;
  v_month text;
  v_window_start timestamptz;
  v_free_used integer;
  v_free integer;
  v_bonus integer;
  v_pending integer;
  v_spent_credits integer;
  v_event uuid;
begin
  if p_user_id is null or p_item_id is null
     or p_consent_version is null or char_length(p_consent_version) not between 1 and 40
     or p_free_per_month is null or p_free_per_month < 0
     or p_budget_usd is null or p_budget_usd <= 0
     or p_price_per_credit_usd is null or p_price_per_credit_usd <= 0
     or p_credits_per_try is null or p_credits_per_try < 1
     or p_max_in_flight is null or p_max_in_flight < 1
     or p_timezone is null or p_timezone !~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$' then
    raise exception 'tryon_reserve : paramètres invalides';
  end if;

  -- Les essais d'un membre passent un par un : un second essai simultané
  -- attend ici la fin du premier, puis le voit « en cours ».
  select * into v_profile from tryon_profiles t where t.user_id = p_user_id for update;
  v_has_profile := found;
  -- Budget et essais en cours de tout le service : un seul verrou commun.
  perform pg_advisory_xact_lock(hashtext('tryon_budget'));
  v_at := coalesce(p_at, clock_timestamp());
  v_month := to_char(v_at at time zone p_timezone, 'YYYY-MM');
  v_window_start := v_at - interval '3 minutes';

  -- Un essai en cours depuis plus de 3 minutes a échoué (serveur arrêté en
  -- route) : libéré, jamais décompté.
  update tryon_events e set status = 'failed', error_code = 'expired', finished_at = v_at
    where e.status = 'pending' and e.created_at < v_window_start;
  if p_at is null then
    perform tryon_purge(12);
  end if;

  if not v_has_profile or v_profile.age_status is distinct from 'adult'
     or v_profile.consent_version is distinct from p_consent_version
     or v_profile.consent_accepted_at is null or v_profile.consent_withdrawn_at is not null then
    return query select 'not_allowed'::text, null::uuid, null::integer, null::integer;
    return;
  end if;

  if exists (select 1 from tryon_events e
             where e.user_id = p_user_id and e.status = 'pending'
               and e.created_at >= v_window_start and e.created_at <= v_at) then
    return query select 'in_progress'::text, null::uuid, null::integer, null::integer;
    return;
  end if;

  select count(*) into v_free_used from tryon_events e
    where e.user_id = p_user_id and e.status = 'succeeded' and e.quota_source = 'free' and e.month = v_month;
  v_free := greatest(p_free_per_month - v_free_used, 0);
  select coalesce(sum(g.remaining), 0) into v_bonus from tryon_bonus_grants g
    where g.user_id = p_user_id and g.remaining > 0 and g.expires_at > v_at;
  if v_free + v_bonus <= 0 then
    return query select 'quota_exhausted'::text, null::uuid, v_free, v_bonus;
    return;
  end if;

  select count(*) into v_pending from tryon_events e
    where e.status = 'pending' and e.created_at >= v_window_start and e.created_at <= v_at;
  if v_pending >= p_max_in_flight then
    return query select 'busy'::text, null::uuid, v_free, v_bonus;
    return;
  end if;

  select coalesce((select u.credits_used from tryon_usage_months u where u.month = v_month), 0) into v_spent_credits;
  if (v_spent_credits + (v_pending + 1) * p_credits_per_try) * p_price_per_credit_usd > p_budget_usd then
    return query select 'budget_reached'::text, null::uuid, v_free, v_bonus;
    return;
  end if;

  insert into tryon_events (user_id, item_id, status, month, created_at)
    values (p_user_id, p_item_id, 'pending', v_month, v_at)
    returning id into v_event;
  return query select 'reserved'::text, v_event, v_free, v_bonus;
end;
$$;

-- Essai réussi : seulement l'essai en cours du membre (ou libéré depuis moins
-- de 10 minutes : l'image a été remise). Décompte le gratuit du mois de la
-- réservation, sinon l'essai offert, valable à la réservation, qui expire le
-- plus tôt. Met à jour les compteurs du mois et enregistre, une fois par
-- mois, les alertes budget_80 (dépense ≥ p_alert_threshold × budget) et
-- budget_100 (le budget ne permet plus un essai de plus) : new_alerts dit
-- lesquelles viennent d'apparaître. status : « completed » ou « not_found ».
-- free_remaining et bonus_remaining : les essais restants après celui-ci.
create or replace function tryon_complete(
  p_event_id uuid,
  p_user_id uuid,
  p_credits_used integer,
  p_duration_ms integer,
  p_free_per_month integer,
  p_budget_usd numeric,
  p_price_per_credit_usd numeric,
  p_alert_threshold numeric,
  p_timezone text,
  p_at timestamptz default null
)
returns table (status text, quota_source text, free_remaining integer, bonus_remaining integer, new_alerts text[])
language plpgsql
set search_path = public
as $$
#variable_conflict use_column
declare
  v_at timestamptz;
  v_event tryon_events%rowtype;
  v_free_used integer;
  v_source text;
  v_grant uuid;
  v_credits integer;
  v_spent numeric;
  v_details jsonb;
  v_alerts text[] := array[]::text[];
  v_month_now text;
  v_free integer;
  v_bonus integer;
begin
  if p_event_id is null or p_user_id is null
     or p_credits_used is null or p_credits_used < 0 or p_credits_used > 10
     or (p_duration_ms is not null and (p_duration_ms < 0 or p_duration_ms > 600000))
     or p_free_per_month is null or p_free_per_month < 0
     or p_budget_usd is null or p_budget_usd <= 0
     or p_price_per_credit_usd is null or p_price_per_credit_usd <= 0
     or p_alert_threshold is null or p_alert_threshold <= 0 or p_alert_threshold > 1
     or p_timezone is null or p_timezone !~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$' then
    raise exception 'tryon_complete : paramètres invalides';
  end if;

  -- Même ordre de verrous que tryon_reserve : le membre, puis le budget.
  perform 1 from tryon_profiles t where t.user_id = p_user_id for update;
  perform pg_advisory_xact_lock(hashtext('tryon_budget'));
  v_at := coalesce(p_at, clock_timestamp());

  select * into v_event from tryon_events e where e.id = p_event_id and e.user_id = p_user_id for update;
  if not found or not (v_event.status = 'pending'
                       or (v_event.status = 'failed' and v_event.error_code = 'expired'
                           and v_event.finished_at > v_at - interval '10 minutes')) then
    return query select 'not_found'::text, null::text, null::integer, null::integer, array[]::text[];
    return;
  end if;

  -- Le gratuit du mois de la réservation d'abord…
  select count(*) into v_free_used from tryon_events e
    where e.user_id = p_user_id and e.status = 'succeeded' and e.quota_source = 'free' and e.month = v_event.month;
  if v_free_used < p_free_per_month then
    v_source := 'free';
  else
    -- … puis l'essai offert qui expire le plus tôt.
    select g.id into v_grant from tryon_bonus_grants g
      where g.user_id = p_user_id and g.remaining > 0 and g.expires_at > v_event.created_at
      order by g.expires_at, g.created_at, g.id
      limit 1
      for update;
    if v_grant is not null then
      update tryon_bonus_grants g set remaining = g.remaining - 1 where g.id = v_grant;
      v_source := 'bonus';
    else
      -- Cas limite (un essai libéré, puis rattrapé après un autre) : compté
      -- sur le mois ; l'image a été remise, il n'est jamais perdu.
      v_source := 'free';
    end if;
  end if;

  update tryon_events e
    set status = 'succeeded', credits_used = p_credits_used, quota_source = v_source, bonus_grant_id = v_grant,
        duration_ms = p_duration_ms, error_code = null, finished_at = v_at
    where e.id = p_event_id;

  insert into tryon_usage_months as u (month, credits_used, tries_succeeded, updated_at)
    values (v_event.month, p_credits_used, 1, v_at)
    on conflict (month) do update
      set credits_used = u.credits_used + excluded.credits_used,
          tries_succeeded = u.tries_succeeded + 1,
          updated_at = excluded.updated_at
    returning u.credits_used into v_credits;

  v_spent := v_credits * p_price_per_credit_usd;
  v_details := jsonb_build_object('spent_usd', round(v_spent, 2), 'budget_usd', p_budget_usd, 'credits', v_credits);
  -- Conditions imbriquées : SQL ne garantit pas l'ordre d'un « and », et
  -- tryon_alert_once écrit.
  if v_spent >= p_alert_threshold * p_budget_usd then
    if tryon_alert_once('budget_80', v_event.month, v_details) then
      v_alerts := v_alerts || 'budget_80'::text;
    end if;
  end if;
  if v_spent + greatest(p_credits_used, 1) * p_price_per_credit_usd > p_budget_usd then
    if tryon_alert_once('budget_100', v_event.month, v_details) then
      v_alerts := v_alerts || 'budget_100'::text;
    end if;
  end if;

  -- Restants pour le mois en cours (celui de maintenant).
  v_month_now := to_char(v_at at time zone p_timezone, 'YYYY-MM');
  select count(*) into v_free_used from tryon_events e
    where e.user_id = p_user_id and e.status = 'succeeded' and e.quota_source = 'free' and e.month = v_month_now;
  v_free := greatest(p_free_per_month - v_free_used, 0);
  select coalesce(sum(g.remaining), 0) into v_bonus from tryon_bonus_grants g
    where g.user_id = p_user_id and g.remaining > 0 and g.expires_at > v_at;
  return query select 'completed'::text, v_source, v_free, v_bonus, v_alerts;
end;
$$;

-- Essai échoué : code court, jamais un texte du fournisseur ; rien n'est
-- décompté. Seulement l'essai en cours du membre (ou libéré, pour garder la
-- vraie raison). true si l'essai a été noté.
create or replace function tryon_fail(p_event_id uuid, p_user_id uuid, p_error_code text, p_duration_ms integer)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  if p_event_id is null or p_user_id is null
     or p_error_code is null or p_error_code !~ '^[a-z][a-z0-9_]{0,39}$'
     or (p_duration_ms is not null and (p_duration_ms < 0 or p_duration_ms > 600000)) then
    raise exception 'tryon_fail : paramètres invalides';
  end if;
  update tryon_events e
    set status = 'failed', error_code = p_error_code, duration_ms = p_duration_ms, finished_at = clock_timestamp()
    where e.id = p_event_id and e.user_id = p_user_id
      and (e.status = 'pending' or (e.status = 'failed' and e.error_code = 'expired'));
  return found;
end;
$$;

-- Statut d'âge, posé une seule fois : true s'il vient d'être enregistré,
-- false s'il l'était déjà (seul tryon_reset_age le remet à zéro).
create or replace function tryon_set_age(p_user_id uuid, p_status text)
returns boolean
language plpgsql
set search_path = public
as $$
declare
  v_set boolean;
begin
  if p_user_id is null or p_status is null or p_status not in ('adult', 'minor') then
    raise exception 'tryon_set_age : paramètres invalides';
  end if;
  insert into tryon_profiles as t (user_id, age_status, age_checked_at)
    values (p_user_id, p_status, clock_timestamp())
    on conflict (user_id) do update
      set age_status = excluded.age_status, age_checked_at = excluded.age_checked_at
      where t.age_status is null
    returning true into v_set;
  return coalesce(v_set, false);
end;
$$;

-- Script d'administration seulement (pnpm tryon:reset-age) : le membre
-- repasse la porte d'âge. true si un statut a été effacé.
create or replace function tryon_reset_age(p_user_id uuid)
returns boolean
language plpgsql
set search_path = public
as $$
begin
  if p_user_id is null then
    raise exception 'tryon_reset_age : paramètres invalides';
  end if;
  update tryon_profiles t set age_status = null, age_checked_at = null
    where t.user_id = p_user_id and t.age_status is not null;
  return found;
end;
$$;

-- Essais offerts pour un achat confirmé. Sans effet si la commande a déjà
-- été accordée (granted = false) ; expires_at : l'expiration de la commande
-- accordée à ce membre, ou null si elle l'a été à un autre membre.
create or replace function tryon_grant_bonus(
  p_user_id uuid,
  p_order_ref text,
  p_quantity integer default 5,
  p_validity_days integer default 365
)
returns table (granted boolean, expires_at timestamptz)
language plpgsql
set search_path = public
as $$
#variable_conflict use_column
declare
  v_expires timestamptz;
  v_owner uuid;
  v_existing_expires timestamptz;
begin
  if p_user_id is null or p_order_ref is null or char_length(p_order_ref) not between 1 and 200
     or p_order_ref <> btrim(p_order_ref)
     or p_quantity is null or p_quantity < 1 or p_quantity > 100
     or p_validity_days is null or p_validity_days < 1 or p_validity_days > 3650 then
    raise exception 'tryon_grant_bonus : paramètres invalides';
  end if;
  if not exists (select 1 from profiles p where p.id = p_user_id) then
    raise exception 'tryon_grant_bonus : membre introuvable';
  end if;
  insert into tryon_bonus_grants (user_id, order_ref, quantity, remaining, expires_at)
    values (p_user_id, p_order_ref, p_quantity, p_quantity, clock_timestamp() + make_interval(days => p_validity_days))
    on conflict (order_ref) do nothing
    returning tryon_bonus_grants.expires_at into v_expires;
  if v_expires is not null then
    return query select true, v_expires;
    return;
  end if;
  select g.user_id, g.expires_at into v_owner, v_existing_expires from tryon_bonus_grants g where g.order_ref = p_order_ref;
  return query select false, case when v_owner = p_user_id then v_existing_expires end;
end;
$$;

-- Le serveur seul : ni les visiteurs, ni les comptes connectés.
revoke all on function tryon_version() from public, anon, authenticated;
grant execute on function tryon_version() to service_role;
revoke all on function tryon_purge(integer) from public, anon, authenticated;
grant execute on function tryon_purge(integer) to service_role;
revoke all on function tryon_alert_once(text, text, jsonb) from public, anon, authenticated;
grant execute on function tryon_alert_once(text, text, jsonb) to service_role;
revoke all on function tryon_remaining(uuid, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function tryon_remaining(uuid, integer, text, timestamptz) to service_role;
revoke all on function tryon_reserve(uuid, uuid, text, integer, numeric, numeric, integer, integer, text, timestamptz) from public, anon, authenticated;
grant execute on function tryon_reserve(uuid, uuid, text, integer, numeric, numeric, integer, integer, text, timestamptz) to service_role;
revoke all on function tryon_complete(uuid, uuid, integer, integer, integer, numeric, numeric, numeric, text, timestamptz) from public, anon, authenticated;
grant execute on function tryon_complete(uuid, uuid, integer, integer, integer, numeric, numeric, numeric, text, timestamptz) to service_role;
revoke all on function tryon_fail(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function tryon_fail(uuid, uuid, text, integer) to service_role;
revoke all on function tryon_set_age(uuid, text) from public, anon, authenticated;
grant execute on function tryon_set_age(uuid, text) to service_role;
revoke all on function tryon_reset_age(uuid) from public, anon, authenticated;
grant execute on function tryon_reset_age(uuid) to service_role;
revoke all on function tryon_grant_bonus(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function tryon_grant_bonus(uuid, text, integer, integer) to service_role;

notify pgrst, 'reload schema';
