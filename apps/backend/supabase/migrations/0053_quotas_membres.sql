-- 0053 (lot « quotas par membre », décisions du fondateur du 2026-11-19) :
-- qu'aucun mois ne finisse dans le négatif chez SerpApi, sans jamais bloquer
-- un abonné à cause de l'usage des comptes gratuits.
--
-- Retour en arrière (dans cet ordre, puis redémarrer le serveur chez Render :
-- la sonde de la migration est mémorisée tant qu'il tourne ; sont alors
-- perdus les droits d'abonnement enregistrés, aucun aujourd'hui, rien ne les
-- écrit encore) :
--   drop function if exists member_quotas_version();
--   drop function if exists serpapi_quota_v2(integer, integer, integer, integer, uuid, boolean, integer, integer, uuid, timestamptz);
--   drop table if exists member_entitlements;
-- serpapi_quota (0029) n'est pas touchée : rien à recréer.
--
-- Ce qu'elle ajoute :
-- 1. member_entitlements : une ligne par membre et par droit d'abonnement
--    (« video » pour Spotto Vidéo, « miroir » pour Spotto Miroir), avec sa
--    date de fin (vide : sans fin), sa source (« revenuecat » plus tard) et
--    la date de sa dernière mise à jour. Supprimée avec le compte. Aucune
--    route ne permet à un membre d'y écrire : seul le serveur le fera, au lot
--    RevenueCat (message d'Apple reçu par RevenueCat, puis par le serveur).
-- 2. serpapi_quota_v2 : la fonction de quota de 0029 (même corps, même
--    verrou commun « serpapi_quota », mêmes trois plafonds), avec deux
--    paramètres de plus :
--    - p_user_monthly_cap : la part de la personne pour le MOIS CIVIL, du 1er
--      à 0 h (heure de Paris) au 1er suivant, indépendante du jour de
--      renouvellement de SerpApi. Elle compte exactement comme la part du
--      jour : une recherche lancée (une photo, une capture de vidéo, un
--      lien), quel que soit le nombre d'appels derrière elle ; jamais une
--      recherche servie par le cache, ni une recherche en panne. Les « Voir
--      les boutiques » d'une pièce (part du jour seulement) n'y comptent pas :
--      ce ne sont pas des recherches envoyées par le membre. 100 pour un
--      compte gratuit ; vide : aucune part du mois (abonné, sauf réglage
--      SUBSCRIBER_MONTHLY_SEARCH_CAP) ;
--    - p_reserve_percent : la part des plafonds GLOBAUX du jour et du mois
--      tenue hors de portée de cette personne (la réserve des abonnés : 30 %
--      pour un compte gratuit quand les abonnements sont allumés, 0 sinon).
--      Un compte gratuit s'arrête à 70 % des deux plafonds, un abonné va
--      jusqu'à 100 %.
--    Nouveau motif de refus « user_month », après le plafond du mois du
--    service et avant la part du jour ; elle renvoie aussi user_month_count
--    (la part du mois déjà prise) et month_resets_on (le 1er du mois suivant).
--    Une NOUVELLE fonction, plutôt qu'un changement de serpapi_quota : un
--    serveur plus ancien continue d'appeler serpapi_quota, inchangée, et
--    rejouer 0029 (fichier groupé prod-1) ne crée aucun doublon ambigu.
-- 3. member_quotas_version : sonde du serveur.
-- Aucun compteur de plus : la part du mois est comptée dans product_searches
-- (index de 0001 sur user_id, created_at), comme la part du jour. Les essais
-- de l'essayage virtuel (0042) ne changent pas : 5 par mois pour un compte
-- gratuit (TRYON_FREE_PER_MONTH), puis les essais offerts, avec leurs tables
-- et leurs fonctions.
--
-- Facultative pour le serveur : sans elle, il fonctionne exactement comme
-- avant (serpapi_quota de 0029 : ni part du mois, ni réserve, tout le monde
-- gratuit) et l'écrit une fois au journal (sonde member_quotas_version,
-- lib/memberQuotas.ts). À appliquer APRÈS 0028 et 0029 (vérifié ci-dessous).
-- D'abord sur spotto-dev-2 (migrer-dev), puis sur spotto-prod. Rejouable sans
-- effet (if not exists, create or replace) ; ne supprime ni ne modifie aucune
-- donnée existante.
-- Aucune règle d'accès public : seul le serveur, avec sa clé secrète, lit et
-- écrit la table (RLS active, aucune politique) et appelle les fonctions.
-- Aucun déclencheur : la suppression d'un compte ne fait qu'une cascade.

do $$
begin
  if to_regclass('public.profiles') is null or to_regclass('public.serpapi_calls') is null then
    raise exception '0053 demande les migrations 0001 à 0022 : appliquez d''abord les migrations précédentes.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'product_searches' and column_name = 'served_from_cache') then
    raise exception '0053 demande la migration 0028 (voie C) : appliquez-la d''abord.';
  end if;
  if to_regprocedure('public.ai_quota(text, uuid, integer, integer, boolean, timestamptz)') is null then
    raise exception '0053 demande la migration 0029 (garde-fous) : appliquez-la d''abord.';
  end if;
end;
$$;

-- ---- 1. Droits d'abonnement ----
create table if not exists member_entitlements (
  user_id uuid not null references profiles(id) on delete cascade,
  entitlement text not null check (entitlement in ('video', 'miroir')),
  expires_at timestamptz,
  source text not null check (source ~ '^[a-z][a-z0-9_]{0,39}$'),
  updated_at timestamptz not null default now(),
  primary key (user_id, entitlement)
);
alter table member_entitlements enable row level security;
revoke all on table member_entitlements from public, anon, authenticated;
grant select, insert, update, delete on table member_entitlements to service_role;

-- ---- 2. serpapi_quota_v2 : part du mois et réserve des abonnés ----
-- Corps de serpapi_quota (0029), avec :
-- - les plafonds globaux du jour et du mois réduits de p_reserve_percent
--   (arrondi à l'entier inférieur) pour cette personne ;
-- - sa part du mois civil (heure de Paris), lue dans la même requête que sa
--   part du jour, avec les mêmes conditions ;
-- - l'ordre des refus : mois du service, part du mois, part du jour, jour du
--   service.
-- p_at : un instant fixé, pour les tests seulement ; le serveur ne le donne jamais.
create or replace function serpapi_quota_v2(
  p_daily_cap integer,
  p_monthly_cap integer,
  p_user_daily_cap integer,
  p_renewal_day integer,
  p_user_id uuid,
  p_reserve boolean,
  p_user_monthly_cap integer,
  p_reserve_percent integer,
  p_exclude_search uuid default null,
  p_at timestamptz default null
)
returns table (allowed boolean, refused_by text, day_count integer, month_count integer, user_day_count integer, next_renewal date, reservation_id bigint, user_month_count integer, month_resets_on date)
language plpgsql
set search_path = public
as $$
declare
  v_at timestamptz;
  v_day_start timestamptz;
  v_month_start timestamptz;
  v_resets date;
  v_cycle_start timestamptz;
  v_next date;
  v_daily_cap integer;
  v_monthly_cap integer;
  v_day integer;
  v_month integer;
  v_user integer;
  v_user_month integer;
  v_stores integer;
  v_reservation bigint;
begin
  if p_daily_cap is null or p_monthly_cap is null or p_user_daily_cap is null or p_user_id is null or p_reserve is null
     or p_daily_cap < 1 or p_monthly_cap < 1 or p_user_daily_cap < 1
     or (p_user_monthly_cap is not null and p_user_monthly_cap < 1)
     or p_reserve_percent is null or p_reserve_percent < 0 or p_reserve_percent > 90 then
    raise exception 'serpapi_quota_v2 : paramètres invalides';
  end if;
  -- Le même verrou que serpapi_quota : un ancien et un nouveau serveur
  -- (pendant une mise en ligne) se mettent dans la même file.
  perform pg_advisory_xact_lock(hashtext('serpapi_quota'));
  v_at := coalesce(p_at, clock_timestamp());
  v_day_start := date_trunc('day', v_at at time zone 'Europe/Paris') at time zone 'Europe/Paris';
  v_month_start := date_trunc('month', v_at at time zone 'Europe/Paris') at time zone 'Europe/Paris';
  v_resets := (date_trunc('month', v_at at time zone 'Europe/Paris') + interval '1 month')::date;
  v_cycle_start := serpapi_cycle_start(p_renewal_day, v_at);
  v_next := serpapi_next_renewal(p_renewal_day, v_at);
  v_daily_cap := ((p_daily_cap::bigint * (100 - p_reserve_percent)) / 100)::integer;
  v_monthly_cap := ((p_monthly_cap::bigint * (100 - p_reserve_percent)) / 100)::integer;

  -- Le jour commence toujours dans le cycle en cours (au plus tôt, avec lui).
  select count(*) filter (where c.called_at >= v_day_start), count(*)
    into v_day, v_month
    from serpapi_calls c
    where c.called_at >= v_cycle_start and c.called_at <= v_at
      and c.released_at is null;

  -- Le jour commence toujours dans le mois civil en cours.
  select count(*) filter (where s.created_at >= v_day_start), count(*)
    into v_user, v_user_month
    from product_searches s
    where s.user_id = p_user_id
      and s.status in ('processing', 'completed', 'failed')
      and s.created_at >= v_month_start and s.created_at <= v_at
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

  if v_month >= v_monthly_cap then
    return query select false, 'month'::text, v_day, v_month, v_user, v_next, null::bigint, v_user_month, v_resets;
    return;
  end if;
  if p_user_monthly_cap is not null and v_user_month >= p_user_monthly_cap then
    return query select false, 'user_month'::text, v_day, v_month, v_user, v_next, null::bigint, v_user_month, v_resets;
    return;
  end if;
  if v_user >= p_user_daily_cap then
    return query select false, 'user'::text, v_day, v_month, v_user, v_next, null::bigint, v_user_month, v_resets;
    return;
  end if;
  if v_day >= v_daily_cap then
    return query select false, 'day'::text, v_day, v_month, v_user, v_next, null::bigint, v_user_month, v_resets;
    return;
  end if;

  if p_reserve then
    insert into serpapi_calls (called_at) values (v_at) returning id into v_reservation;
    v_day := v_day + 1;
    v_month := v_month + 1;
    v_user := v_user + 1;
    v_user_month := v_user_month + 1;
  end if;
  return query select true, null::text, v_day, v_month, v_user, v_next, v_reservation, v_user_month, v_resets;
end;
$$;

-- ---- 3. Sonde du serveur : la migration est-elle là ? ----
create or replace function member_quotas_version()
returns integer
language plpgsql
stable
set search_path = public
as $$
begin
  return 1;
end;
$$;

-- Le serveur seul : ni les visiteurs, ni les comptes connectés.
revoke all on function serpapi_quota_v2(integer, integer, integer, integer, uuid, boolean, integer, integer, uuid, timestamptz) from public, anon, authenticated;
grant execute on function serpapi_quota_v2(integer, integer, integer, integer, uuid, boolean, integer, integer, uuid, timestamptz) to service_role;
revoke all on function member_quotas_version() from public, anon, authenticated;
grant execute on function member_quotas_version() to service_role;

notify pgrst, 'reload schema';
