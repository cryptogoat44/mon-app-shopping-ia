-- Lot 4 quater (décisions du fondateur, 2026-10-08) : plafond GLOBAL des
-- recherches SerpApi, par jour (heure de Paris) et sur 31 jours glissants, et
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

-- Première écriture de la fonction (spotto-dev seulement, jamais en production).
drop function if exists serpapi_quota(integer, integer, boolean, timestamptz);

-- Réserve un appel (p_reserve = true), ou lit seulement l'état (false), pour
-- la personne p_user_id. Trois plafonds, dans cet ordre : 31 jours glissants
-- (tout le service), part de la personne pour la journée, jour (tout le
-- service) ; refused_by dit lequel est atteint.
-- La part de la personne compte ses recherches du jour qui ont atteint
-- SerpApi (en cours, abouties ou non), lues dans product_searches — aucune
-- donnée personnelle de plus ; p_exclude_search : la recherche en cours de
-- lancement, déjà marquée « en cours ».
-- Atomique : un verrou de transaction met les demandes en file, et l'instant
-- de référence est lu APRÈS ce verrou (lu avant, une demande en attente
-- ignorait les appels réservés juste avant elle — trouvé par un test).
-- « Mois » = 31 jours glissants : quelle que soit la date de renouvellement du
-- quota chez SerpApi (le 3 de chaque mois en octobre 2026), aucune de ses
-- périodes ne peut dépasser le plafond.
-- p_at : un instant fixé, pour les tests seulement (dans le passé, jamais mêlé
-- aux vrais appels) ; le serveur ne le donne jamais.
create or replace function serpapi_quota(
  p_daily_cap integer,
  p_monthly_cap integer,
  p_user_daily_cap integer,
  p_user_id uuid,
  p_reserve boolean,
  p_exclude_search uuid default null,
  p_at timestamptz default null
)
returns table (allowed boolean, refused_by text, day_count integer, window_count integer, user_day_count integer)
language plpgsql
set search_path = public
as $$
declare
  v_at timestamptz;
  v_day_start timestamptz;
  v_day integer;
  v_window integer;
  v_user integer;
begin
  if p_daily_cap is null or p_monthly_cap is null or p_user_daily_cap is null or p_user_id is null
     or p_daily_cap < 1 or p_monthly_cap < 1 or p_user_daily_cap < 1 then
    raise exception 'serpapi_quota : paramètres invalides';
  end if;
  perform pg_advisory_xact_lock(hashtext('serpapi_quota'));
  v_at := coalesce(p_at, clock_timestamp());
  v_day_start := date_trunc('day', v_at at time zone 'Europe/Paris') at time zone 'Europe/Paris';

  select count(*) filter (where c.called_at >= v_day_start), count(*)
    into v_day, v_window
    from serpapi_calls c
    where c.called_at > v_at - interval '31 days' and c.called_at <= v_at;

  select count(*)
    into v_user
    from product_searches s
    where s.user_id = p_user_id
      and s.status in ('processing', 'completed', 'failed')
      and s.created_at >= v_day_start and s.created_at <= v_at
      and s.id is distinct from p_exclude_search;

  if v_window >= p_monthly_cap then
    return query select false, 'month'::text, v_day, v_window, v_user;
    return;
  end if;
  if v_user >= p_user_daily_cap then
    return query select false, 'user'::text, v_day, v_window, v_user;
    return;
  end if;
  if v_day >= p_daily_cap then
    return query select false, 'day'::text, v_day, v_window, v_user;
    return;
  end if;

  if p_reserve then
    insert into serpapi_calls (called_at) values (v_at);
    v_day := v_day + 1;
    v_window := v_window + 1;
    v_user := v_user + 1;
  end if;
  return query select true, null::text, v_day, v_window, v_user;
end;
$$;

-- Le serveur seul : ni les visiteurs, ni les comptes connectés.
revoke all on function serpapi_quota(integer, integer, integer, uuid, boolean, uuid, timestamptz) from public, anon, authenticated;
grant execute on function serpapi_quota(integer, integer, integer, uuid, boolean, uuid, timestamptz) to service_role;

notify pgrst, 'reload schema';
