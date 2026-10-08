-- Lot 4 quater (décision du fondateur, 2026-10-08) : plafond GLOBAL des
-- recherches SerpApi, par jour (heure de Paris) et sur 31 jours glissants, en
-- plus des limites par personne (lib/rateLimits.ts). Le compteur est gardé
-- dans la base : en mémoire, il repartirait de zéro à chaque redémarrage du
-- serveur (mise en veille de l'offre gratuite de Render, déploiements).
--
-- Une ligne par appel réservé, avec sa seule date : ni compte, ni adresse,
-- ni contenu — aucune donnée personnelle, donc rien à exporter ni à effacer
-- avec un compte. Lue et écrite uniquement par le serveur (clé service_role) :
-- RLS active, aucune politique ; aucune clé étrangère.
create table if not exists serpapi_calls (
  id bigint generated always as identity primary key,
  called_at timestamptz not null default now()
);
create index if not exists serpapi_calls_called_at_idx on serpapi_calls (called_at);
alter table serpapi_calls enable row level security;

-- Réserve un appel (p_reserve = true), ou lit seulement l'état (false).
-- Atomique : un verrou de transaction met les demandes en file, deux
-- recherches simultanées ne peuvent pas dépasser le plafond.
-- « Mois » = 31 jours glissants : quelle que soit la date de renouvellement
-- du quota chez SerpApi (le 3 de chaque mois en octobre 2026), aucune de ses
-- périodes ne peut dépasser le plafond.
-- Plafond atteint : retry_at = à partir de quand un appel redevient possible
-- (minuit, heure de Paris, pour le jour ; sortie du plus ancien appel de la
-- fenêtre, pour les 31 jours).
-- L'instant de référence est lu APRÈS le verrou : une demande qui attendait
-- voit les appels réservés juste avant elle (lu avant, il les ignorait et le
-- plafond pouvait être dépassé — trouvé par le test des demandes simultanées).
-- p_at : un instant fixé, pour les tests seulement (dans le passé, jamais
-- mêlé aux vrais appels) ; le serveur ne le donne jamais.
create or replace function serpapi_quota(
  p_daily_cap integer,
  p_monthly_cap integer,
  p_reserve boolean,
  p_at timestamptz default null
)
returns table (allowed boolean, cap_period text, day_count integer, window_count integer, retry_at timestamptz)
language plpgsql
set search_path = public
as $$
declare
  v_at timestamptz;
  v_local_day timestamp;
  v_day_start timestamptz;
  v_next_day timestamptz;
  v_window_start timestamptz;
  v_day integer;
  v_window integer;
begin
  if p_daily_cap is null or p_monthly_cap is null or p_daily_cap < 1 or p_monthly_cap < 1 then
    raise exception 'serpapi_quota : plafonds invalides';
  end if;
  perform pg_advisory_xact_lock(hashtext('serpapi_quota'));
  v_at := coalesce(p_at, clock_timestamp());
  v_local_day := date_trunc('day', v_at at time zone 'Europe/Paris');
  v_day_start := v_local_day at time zone 'Europe/Paris';
  v_next_day := (v_local_day + interval '1 day') at time zone 'Europe/Paris';
  v_window_start := v_at - interval '31 days';

  select count(*) filter (where c.called_at >= v_day_start), count(*)
    into v_day, v_window
    from serpapi_calls c
    where c.called_at > v_window_start and c.called_at <= v_at;

  if v_window >= p_monthly_cap then
    return query
      select false, 'month'::text, v_day, v_window, c.called_at + interval '31 days'
      from serpapi_calls c
      where c.called_at > v_window_start and c.called_at <= v_at
      order by c.called_at
      offset (v_window - p_monthly_cap)
      limit 1;
    return;
  end if;
  if v_day >= p_daily_cap then
    return query select false, 'day'::text, v_day, v_window, v_next_day;
    return;
  end if;

  if p_reserve then
    insert into serpapi_calls (called_at) values (v_at);
    v_day := v_day + 1;
    v_window := v_window + 1;
  end if;
  return query select true, null::text, v_day, v_window, null::timestamptz;
end;
$$;

-- Le serveur seul : ni les visiteurs, ni les comptes connectés.
revoke all on function serpapi_quota(integer, integer, boolean, timestamptz) from public, anon, authenticated;
grant execute on function serpapi_quota(integer, integer, boolean, timestamptz) to service_role;

notify pgrst, 'reload schema';
