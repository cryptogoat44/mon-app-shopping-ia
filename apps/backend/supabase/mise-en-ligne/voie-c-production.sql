-- ============================================================================
-- MISE EN LIGNE DE LA VOIE C (lot c, migration 0028) — PRODUCTION
-- ============================================================================
-- À coller dans l'éditeur SQL du projet de PRODUCTION : l'adresse de la page
-- doit contenir selhqdqfrflsqivgxypf (spotto-prod ; jamais sedfepcpmhilaxbrgdif
-- = spotto-dev-2, ni les anciens projets qcwnlqkxnhqpyjpkooiw et
-- sbtwsmxfdfxzgcohbznd).
--
-- AVANT : la nouvelle version du serveur ET du site est en ligne sur Render
-- (« Manual Deploy », « Deploy latest commit », le même commit pour les deux),
-- interrupteurs de la voie C coupés (VOIE_C_ENABLED absent ou différent de
-- "true"). Facultatif : docs/avant-0028-controle.sql montre l'état d'avant
-- (attendu : « absente », serpapi_quota « 0027 »).
--
-- Ce fichier, en une seule transaction (tout ou rien) :
--   1. prend d'un coup les deux tables touchées (product_searches et
--      product_matches), sans attendre : si une recherche les occupe à cet
--      instant, il s'arrête aussitôt sur « could not obtain lock on
--      relation », sans rien changer ; le relancer quelques secondes plus
--      tard. Ainsi la migration ne peut pas se bloquer avec une recherche en
--      cours (relecture croisée du 3 novembre 2026) ;
--   2. applique la migration 0028 (texte identique à
--      supabase/migrations/0028_voie_c.sql, déjà appliquée, répétée en retour
--      arrière et vérifiée sur spotto-dev-2) ;
--   3. affiche la vérification (texte identique à
--      supabase/verifications/0028-verification.sql) : une seule ligne,
--      attendue : true | key text NO, step text NO, payload jsonb NO,
--      created_at timestamp with time zone NO, expires_at timestamp with time
--      zone NO | true | true | 0 | 0 | true | true | 8 | true | true | true |
--      true.
-- Aucune donnée existante n'est effacée ni réécrite : 0028 ajoute une table,
-- des colonnes avec leurs valeurs par défaut et une règle, et remplace
-- serpapi_quota (mêmes paramètres, mêmes droits).
--
-- EN CAS D'ERREUR : rien n'a changé. Copier le message à Claude. Si l'éditeur
-- répond ensuite « current transaction is aborted », lancer « rollback; »
-- seul, puis relancer ce fichier. Une fois passé avec succès, le relancer est
-- sans effet (0028 est rejouable) ; pour revérifier, lancer seulement
-- supabase/verifications/0028-verification.sql.
--
-- APRÈS, seulement quand le fondateur le décide (avocat et nouvelle politique
-- de confidentialité d'abord) : VOIE_C_ENABLED puis VOIE_C_AI_ENABLED à
-- "true" dans Render > spotto-api > Environment (appels payants).
-- Retour en arrière : docs/0028-retour.sql (sur le Mac du fondateur).
-- ============================================================================

begin;

lock table public.product_searches, public.product_matches in access exclusive mode nowait;

-- ============================================================================
-- 0028_voie_c.sql
-- ============================================================================
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
-- Rejouable sans effet (if not exists ; une colonne ou une table déjà là,
-- laissée par un brouillon, est gardée telle quelle : la vérification
-- supabase/verifications/0028-verification.sql le montre). Le fondateur
-- l'applique sur spotto-dev-2 avec migrer-dev AVANT de mettre
-- VOIE_C_ENABLED à "true".
--
-- Serveur et base migrée : seul un serveur qui a déjà les libellés d'export
-- de 0028 (un petit commit sur main, sans interrupteur ni changement de
-- comportement, comme pour 0027) fonctionne sans écart avec la base migrée.
-- Un serveur plus ancien — la production tourne aujourd'hui sur f0ec229, qui
-- ne les a pas — garde ses recherches et son quota (valeurs par défaut :
-- origine 'lens', booléens faux, 0 appel ; zod ignore les colonnes qu'il ne
-- connaît pas ; serpapi_quota garde ses paramètres et ce qu'elle renvoie),
-- mais son export RGPD lisible montre les 9 nouvelles colonnes sous leur nom
-- brut (« Autres informations »), les journalise à chaque export, et son test
-- exportCompleteness échoue (« colonne sans libellé »). Ordre à tenir :
-- 1. les libellés d'export de 0028 sur main, puis dans les lots en cours ;
-- 2. 0028 sur spotto-dev-2, puis les tests de base de données sur le Mac ;
-- 3. fusion de la voie C dans main ;
-- 4. en production : mettre en ligne le serveur et le site de la voie C
--    depuis le même commit (le site d'abord ou en même temps), interrupteurs
--    coupés ; PUIS appliquer 0028 sur spotto-prod ; PUIS seulement, le
--    nouveau site en ligne et les onglets ouverts rechargés, VOIE_C_ENABLED
--    puis VOIE_C_AI_ENABLED à "true" (l'ancien site mêlerait les pièces des
--    boutiques aux résultats Lens) ;
-- 5. tant que 0028 est appliquée, ne jamais revenir sur Render à un serveur
--    antérieur au commit des libellés.
-- Le nouveau serveur sur une base sans 0028 : la voie C reste coupée
-- (interrupteur coupé par défaut, et sonde du schéma). La sonde ne protège
-- qu'un serveur qui n'a pas encore vu 0028 : une fois vue, elle est
-- mémorisée jusqu'au redémarrage du serveur (d'où l'étape 0 ci-dessous).
--
-- Retour en arrière (docs/0028-retour.sql, sur le Mac), dans cet ordre :
-- 0. couper la voie C : VOIE_C_ENABLED à toute autre valeur que "true" (ou
--    retirée) dans Render, puis déployer et attendre que le nouveau
--    déploiement soit en service (l'interrupteur n'est lu qu'au démarrage, et
--    la sonde du schéma est mémorisée tant que le serveur tourne) ;
-- 1. recréer serpapi_quota avec le corps exact de 0027, EN PREMIER ;
-- 2. drop table if exists search_cache ;
-- 3. retirer les nouvelles colonnes de product_searches et la contrainte ;
-- 4. retirer product_matches.origin.
-- Retour du code seul sur Render (base gardée migrée ; vers un serveur qui a
-- les libellés, voir le point 5) : l'ancien serveur ne touche jamais à
-- search_cache, donc ne la purge pas ; vider la table aussitôt :
-- delete from search_cache; (la voie C, si elle revient, repart d'un cache
-- vide). De même sur spotto-dev-2 en revenant à main.

-- ---- Origine de chaque proposition ----
-- 'lens' : la recherche visuelle ; 'shopping' : la même pièce dans d'autres
-- boutiques (requête de l'IA) ; 'words' : la recherche avec vos mots (voie B).
alter table product_matches
  add column if not exists origin text not null default 'lens' check (origin in ('lens', 'shopping', 'words'));

-- ---- Complément de chaque recherche ----
-- complement_status : issue du complément, vide quand la voie C n'a pas tourné
--   (shown, empty, no_query, ai_failed, shopping_failed, no_time, no_capacity,
--   skipped : étape IA coupée, error : exception inattendue) ;
-- shopping_calls : recherches Google Shopping comptées pour cette photo
--   (boutiques au plus 1, vos mots au plus 1 ; un refus non facturé dont la
--   place a été rendue n'y compte pas) ; avec Lens (0 s'il vient du cache,
--   sinon 1), jamais plus de 3 recherches par photo ;
-- lens_from_cache : la réponse de Lens vient du cache (aucun appel Lens) ;
-- served_from_cache : aucune recherche réelle comptée dans ce lancement (tout
--   vient du cache) : hors de la part de 8 par personne ;
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
-- Le serveur de la voie C (lui seul) supprime les lignes expirées à la
-- première préparation de recherche qui suit leurs 24 h, même voie C coupée ;
-- après un retour du code seul, vider la table (voir l'en-tête).
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
-- Une recherche servie par le cache ne peut lancer la voie B que le jour (de
-- Paris) de sa création : cet appel réel la retire alors des recherches
-- « servies par le cache », et elle compte comme une photo ce jour-là (sinon,
-- une boucle relance + vos mots ne serait jamais comptée). Plus tard, elle ne
-- compterait dans aucune part de 8 (seules y comptent les recherches créées
-- le jour même) : le serveur refuse alors la voie B. Un refus non facturé
-- dont la place est rendue ne compte pas : elle reste « servie par le cache ».
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

commit;

-- ============================================================================
-- 0028-verification.sql
-- ============================================================================
-- Vérification de la migration 0028 (lot c, voie C). Lecture seule.
-- À lancer sur la base où la migration vient d'être appliquée (spotto-dev-2
-- d'abord, la production bien plus tard, après l'avis de la juriste).
--
-- Résultat attendu : une seule ligne,
--   true | key text NO, step text NO, payload jsonb NO, created_at timestamp with time zone NO, expires_at timestamp with time zone NO
--   | true | true | 0 | 0 | true | true | 8 | true | true | true | true
-- soit :
--   cache_forme_exacte = true : search_cache a EXACTEMENT les colonnes de 0028,
--     dans cet ordre, avec ces types (une autre forme, laissée par exemple par
--     la séance du 1er novembre sur le Mac, donne false : la colonne suivante
--     la montre telle quelle ; ne pas mettre VOIE_C_ENABLED à "true" avant
--     d'avoir compris d'où elle vient) ;
--   cache_colonnes : les colonnes lues, « nom type nullable » ;
--   cache_cle_primaire = true : la clé primaire est la colonne key ;
--   rls_cache = true : sa protection ligne par ligne (RLS) est active ;
--   politiques_cache = 0 : aucune règle n'ouvre l'accès public de Supabase ;
--   droits_publics_cache = 0 : aucun droit pour anon, authenticated ni public
--     (seul le serveur, avec sa clé secrète, la lit et l'écrit) ;
--   index_expiration = true : l'index qui sert à supprimer les lignes expirées ;
--   cache_regles_exactes = true : les règles de search_cache sont EXACTEMENT
--     celles de 0028 (clé de 64 caractères hexadécimaux, étapes lens / query /
--     shopping, 256 Ko au plus, expiration après la création), avec created_at
--     à now() par défaut et l'index sur expires_at (une table de même forme
--     laissée par un brouillon, avec d'autres règles, donne false) ;
--   colonnes_recherche = 8 : les 8 nouvelles colonnes de product_searches, avec
--     leur type ;
--   colonne_origine = true : product_matches.origin, obligatoire, 'lens' par défaut ;
--   colonnes_voie_c_exactes = true : les 9 colonnes de la voie C ont
--     exactement ce type, ce caractère obligatoire et cette valeur par défaut
--     (une colonne laissée par un brouillon, que « add column if not exists »
--     garde telle quelle, donne false) ;
--   contraintes_voie_c_exactes = true : les règles de ces colonnes sont
--     exactement celles de 0028 (origin lens/shopping/words, les 9 issues, les
--     3 issues de vos mots, shopping_calls 0 à 2, total_seconds 0 à 600,
--     servie par le cache ⇒ Lens venu du cache) ; une règle en plus ou plus
--     étroite, laissée par un brouillon, donne false ;
--   quota_sans_cache = true : serpapi_quota ignore les recherches servies par
--     le cache dans la part de la personne.
-- Un false sur cache_regles_exactes, colonnes_voie_c_exactes ou
-- contraintes_voie_c_exactes : ne pas mettre VOIE_C_ENABLED à "true" avant
-- d'avoir compris d'où vient l'écart (les colonnes et les règles de
-- search_cache, product_searches et product_matches, comparées à celles de
-- 0028). Tri « collate "C" » : le même ordre quelle que soit la
-- langue de la base.
select
  (
    select string_agg(column_name || ' ' || data_type || ' ' || is_nullable, ', ' order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'search_cache'
  ) is not distinct from 'key text NO, step text NO, payload jsonb NO, created_at timestamp with time zone NO, expires_at timestamp with time zone NO'
    as cache_forme_exacte,
  (
    select string_agg(column_name || ' ' || data_type || ' ' || is_nullable, ', ' order by ordinal_position)
    from information_schema.columns
    where table_schema = 'public' and table_name = 'search_cache'
  ) as cache_colonnes,
  coalesce((
    select array_agg(a.attname::text) = array['key']
    from pg_index i
    join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
    where i.indrelid = to_regclass('public.search_cache') and i.indisprimary
  ), false) as cache_cle_primaire,
  coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.search_cache')), false) as rls_cache,
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'search_cache') as politiques_cache,
  (
    select count(*)::int from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'search_cache'
      and grantee in ('anon', 'authenticated', 'PUBLIC')
  ) as droits_publics_cache,
  exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'search_cache' and indexname = 'search_cache_expires_at_idx') as index_expiration,
  (
    select string_agg(pg_get_constraintdef(c.oid), ', ' order by pg_get_constraintdef(c.oid) collate "C")
    from pg_constraint c
    where c.conrelid = to_regclass('public.search_cache') and c.contype = 'c'
  ) || ' | ' || coalesce((
    select column_default from information_schema.columns
    where table_schema = 'public' and table_name = 'search_cache' and column_name = 'created_at'
  ), '-') || ' | ' || coalesce(pg_get_indexdef(to_regclass('public.search_cache_expires_at_idx')), '-')
  is not distinct from 'CHECK ((expires_at > created_at)), CHECK ((key ~ ''^[0-9a-f]{64}$''::text)), CHECK ((octet_length((payload)::text) <= 262144)), CHECK ((step = ANY (ARRAY[''lens''::text, ''query''::text, ''shopping''::text]))) | now() | CREATE INDEX search_cache_expires_at_idx ON public.search_cache USING btree (expires_at)'
    as cache_regles_exactes,
  (
    select count(*)::int from information_schema.columns
    where table_schema = 'public' and table_name = 'product_searches'
      and ((column_name = 'complement_status' and data_type = 'text')
        or (column_name = 'shopping_calls' and data_type = 'smallint' and is_nullable = 'NO')
        or (column_name = 'lens_from_cache' and data_type = 'boolean' and is_nullable = 'NO')
        or (column_name = 'served_from_cache' and data_type = 'boolean' and is_nullable = 'NO')
        or (column_name = 'text_suggested' and data_type = 'boolean' and is_nullable = 'NO')
        or (column_name = 'text_requested_at' and data_type = 'timestamp with time zone')
        or (column_name = 'text_status' and data_type = 'text')
        or (column_name = 'total_seconds' and data_type = 'smallint'))
  ) as colonnes_recherche,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'product_matches' and column_name = 'origin'
      and data_type = 'text' and is_nullable = 'NO' and column_default like '''lens''%'
  ) as colonne_origine,
  (
    select string_agg(table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '-'), ', ' order by table_name collate "C", column_name collate "C")
    from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'product_matches' and column_name = 'origin')
        or (table_name = 'product_searches' and column_name in ('complement_status', 'shopping_calls', 'lens_from_cache', 'served_from_cache', 'text_suggested', 'text_requested_at', 'text_status', 'total_seconds')))
  ) is not distinct from 'product_matches.origin text NO ''lens''::text, product_searches.complement_status text YES -, product_searches.lens_from_cache boolean NO false, product_searches.served_from_cache boolean NO false, product_searches.shopping_calls smallint NO 0, product_searches.text_requested_at timestamp with time zone YES -, product_searches.text_status text YES -, product_searches.text_suggested boolean NO false, product_searches.total_seconds smallint YES -'
    as colonnes_voie_c_exactes,
  (
    select string_agg(t.relname || ' ' || pg_get_constraintdef(c.oid), ', ' order by t.relname collate "C", pg_get_constraintdef(c.oid) collate "C")
    from pg_constraint c join pg_class t on t.oid = c.conrelid
    where c.contype = 'c' and t.relnamespace = 'public'::regnamespace
      and exists (select 1 from pg_attribute a where a.attrelid = c.conrelid and a.attnum = any(c.conkey)
        and ((t.relname = 'product_matches' and a.attname = 'origin')
          or (t.relname = 'product_searches' and a.attname in ('complement_status', 'shopping_calls', 'lens_from_cache', 'served_from_cache', 'text_suggested', 'text_requested_at', 'text_status', 'total_seconds'))))
  ) is not distinct from 'product_matches CHECK ((origin = ANY (ARRAY[''lens''::text, ''shopping''::text, ''words''::text]))), product_searches CHECK (((NOT served_from_cache) OR lens_from_cache)), product_searches CHECK (((shopping_calls >= 0) AND (shopping_calls <= 2))), product_searches CHECK (((total_seconds >= 0) AND (total_seconds <= 600))), product_searches CHECK ((complement_status = ANY (ARRAY[''shown''::text, ''empty''::text, ''no_query''::text, ''ai_failed''::text, ''shopping_failed''::text, ''no_time''::text, ''no_capacity''::text, ''skipped''::text, ''error''::text]))), product_searches CHECK ((text_status = ANY (ARRAY[''shown''::text, ''empty''::text, ''shopping_failed''::text])))'
    as contraintes_voie_c_exactes,
  coalesce((
    select bool_and(pg_get_functiondef(p.oid) like '%served_from_cache%') from pg_proc p
    where p.proname = 'serpapi_quota' and p.pronamespace = 'public'::regnamespace
  ), false) as quota_sans_cache;

