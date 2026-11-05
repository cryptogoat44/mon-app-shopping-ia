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
