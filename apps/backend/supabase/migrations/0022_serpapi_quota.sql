-- Lot 4 quater (décisions du fondateur, 2026-10-08) : plafond GLOBAL des
-- recherches SerpApi, par jour (heure de Paris) et par CYCLE MENSUEL aligné sur
-- le jour de renouvellement du quota chez SerpApi (le 3 en octobre 2026), et
-- PART DE CHAQUE PERSONNE par jour, en plus des limites par personne existantes
-- (lib/rateLimits.ts). Tout est compté dans la base : en mémoire, les compteurs
-- repartiraient de zéro à chaque redémarrage du serveur (mise en veille de
-- l'offre gratuite de Render, déploiements).
--
-- Plafond global : une ligne par appel réservé, avec sa seule date — ni
-- compte, ni adresse, ni contenu : aucune donnée personnelle, donc rien à
-- exporter ni à effacer avec un compte. Lue et écrite uniquement par le
-- serveur (clé service_role) : RLS active, aucune politique ; aucune clé
-- étrangère.
create table if not exists serpapi_calls (
  id bigint generated always as identity primary key,
  called_at timestamptz not null default now()
);
create index if not exists serpapi_calls_called_at_idx on serpapi_calls (called_at);
alter table serpapi_calls enable row level security;

-- Écritures précédentes de la fonction (spotto-dev seulement, jamais en production).
drop function if exists serpapi_quota(integer, integer, boolean, timestamptz);
drop function if exists serpapi_quota(integer, integer, integer, uuid, boolean, uuid, timestamptz);

-- Début du cycle en cours : minuit (heure de Paris) du dernier jour de
-- renouvellement passé, ou d'aujourd'hui. Un mois plus court que ce jour
-- renouvelle à son dernier jour (le 31 : le 30 en avril, le 28 ou le 29 en
-- février). Le 2 janvier, avec un renouvellement le 3, le cycle a commencé le
-- 3 décembre de l'année précédente.
create or replace function serpapi_cycle_start(p_renewal_day integer, p_at timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  v_today date;
  v_month date;
  v_renewal date;
begin
  if p_renewal_day is null or p_renewal_day < 1 or p_renewal_day > 31 or p_at is null then
    raise exception 'serpapi_cycle_start : paramètres invalides';
  end if;
  v_today := (p_at at time zone 'Europe/Paris')::date;
  v_month := date_trunc('month', v_today)::date;
  v_renewal := v_month + (least(p_renewal_day, extract(day from (v_month + interval '1 month - 1 day'))::integer) - 1);
  if v_renewal > v_today then
    v_month := (v_month - interval '1 month')::date;
    v_renewal := v_month + (least(p_renewal_day, extract(day from (v_month + interval '1 month - 1 day'))::integer) - 1);
  end if;
  return v_renewal::timestamp at time zone 'Europe/Paris';
end;
$$;

-- Réserve un appel (p_reserve = true), ou lit seulement l'état (false), pour
-- la personne p_user_id. Trois plafonds, dans cet ordre : le mois (tout le
-- service, depuis le début du cycle de SerpApi : il se libère quand le quota
-- de SerpApi revient), la part de la personne pour la journée, le jour (tout
-- le service) ; refused_by dit lequel est atteint.
-- La part de la personne compte ses recherches du jour qui ont atteint
-- SerpApi (en cours, abouties ou non), lues dans product_searches — aucune
-- donnée personnelle de plus ; p_exclude_search : la recherche en cours de
-- lancement, déjà marquée « en cours ».
-- Atomique : un verrou de transaction met les demandes en file, et l'instant
-- de référence est lu APRÈS ce verrou (lu avant, une demande en attente
-- ignorait les appels réservés juste avant elle — trouvé par un test).
-- p_at : un instant fixé, pour les tests seulement (dans le passé, jamais mêlé
-- aux vrais appels) ; le serveur ne le donne jamais.
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
returns table (allowed boolean, refused_by text, day_count integer, month_count integer, user_day_count integer)
language plpgsql
set search_path = public
as $$
declare
  v_at timestamptz;
  v_day_start timestamptz;
  v_cycle_start timestamptz;
  v_day integer;
  v_month integer;
  v_user integer;
begin
  if p_daily_cap is null or p_monthly_cap is null or p_user_daily_cap is null or p_user_id is null
     or p_daily_cap < 1 or p_monthly_cap < 1 or p_user_daily_cap < 1 then
    raise exception 'serpapi_quota : paramètres invalides';
  end if;
  perform pg_advisory_xact_lock(hashtext('serpapi_quota'));
  v_at := coalesce(p_at, clock_timestamp());
  v_day_start := date_trunc('day', v_at at time zone 'Europe/Paris') at time zone 'Europe/Paris';
  v_cycle_start := serpapi_cycle_start(p_renewal_day, v_at);

  -- Le jour commence toujours dans le cycle en cours (au plus tôt, avec lui).
  select count(*) filter (where c.called_at >= v_day_start), count(*)
    into v_day, v_month
    from serpapi_calls c
    where c.called_at >= v_cycle_start and c.called_at <= v_at;

  select count(*)
    into v_user
    from product_searches s
    where s.user_id = p_user_id
      and s.status in ('processing', 'completed', 'failed')
      and s.created_at >= v_day_start and s.created_at <= v_at
      and s.id is distinct from p_exclude_search;

  if v_month >= p_monthly_cap then
    return query select false, 'month'::text, v_day, v_month, v_user;
    return;
  end if;
  if v_user >= p_user_daily_cap then
    return query select false, 'user'::text, v_day, v_month, v_user;
    return;
  end if;
  if v_day >= p_daily_cap then
    return query select false, 'day'::text, v_day, v_month, v_user;
    return;
  end if;

  if p_reserve then
    insert into serpapi_calls (called_at) values (v_at);
    v_day := v_day + 1;
    v_month := v_month + 1;
    v_user := v_user + 1;
  end if;
  return query select true, null::text, v_day, v_month, v_user;
end;
$$;

-- Premier démarrage : le compteur part de zéro, alors que SerpApi a peut-être
-- déjà compté des recherches dans le cycle en cours (avant le compteur, ou par
-- les outils d'essai). À la mise en ligne, le fondateur reporte le nombre lu
-- chez SerpApi : autant d'appels, datés du début du cycle. Sans effet si le
-- cycle compte déjà des appels (jamais en double). Renvoie le total du cycle.
create or replace function serpapi_seed_cycle(p_renewal_day integer, p_count integer, p_at timestamptz default null)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_at timestamptz;
  v_start timestamptz;
  v_total integer;
begin
  if p_count is null or p_count < 0 or p_count > 100000 then
    raise exception 'serpapi_seed_cycle : nombre invalide';
  end if;
  perform pg_advisory_xact_lock(hashtext('serpapi_quota'));
  v_at := coalesce(p_at, clock_timestamp());
  v_start := serpapi_cycle_start(p_renewal_day, v_at);
  select count(*) into v_total from serpapi_calls where called_at >= v_start and called_at <= v_at;
  if v_total = 0 and p_count > 0 then
    insert into serpapi_calls (called_at) select v_start from generate_series(1, p_count);
    v_total := p_count;
  end if;
  return v_total;
end;
$$;

-- Le serveur seul : ni les visiteurs, ni les comptes connectés.
revoke all on function serpapi_cycle_start(integer, timestamptz) from public, anon, authenticated;
grant execute on function serpapi_cycle_start(integer, timestamptz) to service_role;
revoke all on function serpapi_quota(integer, integer, integer, integer, uuid, boolean, uuid, timestamptz) from public, anon, authenticated;
grant execute on function serpapi_quota(integer, integer, integer, integer, uuid, boolean, uuid, timestamptz) to service_role;
revoke all on function serpapi_seed_cycle(integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function serpapi_seed_cycle(integer, integer, timestamptz) to service_role;

notify pgrst, 'reload schema';
