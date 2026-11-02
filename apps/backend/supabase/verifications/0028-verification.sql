-- Vérification de la migration 0028 (lot c, voie C). Lecture seule.
-- À lancer sur la base où la migration vient d'être appliquée (spotto-dev-2
-- d'abord, la production bien plus tard, après l'avis de la juriste).
--
-- Résultat attendu : une seule ligne,
--   true | key text NO, step text NO, payload jsonb NO, created_at timestamp with time zone NO, expires_at timestamp with time zone NO
--   | true | true | 0 | 0 | true | 8 | true | true | true | true | true | true
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
--   colonnes_recherche = 8 : les 8 nouvelles colonnes de product_searches, avec
--     leur type ;
--   colonne_origine = true : product_matches.origin, obligatoire, 'lens' par défaut ;
--   contrainte_origine = true : origin n'accepte que lens, shopping et words ;
--   contrainte_complement = true : complement_status accepte les 9 issues,
--     « error » comprise ;
--   contrainte_cache_servi = true : servie par le cache ⇒ Lens venu du cache ;
--   contrainte_appels = true : shopping_calls entre 0 et 2 ;
--   quota_sans_cache = true : serpapi_quota ignore les recherches servies par
--     le cache dans la part de la personne.
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
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.product_matches'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%origin%' and pg_get_constraintdef(oid) like '%words%'
  ) as contrainte_origine,
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.product_searches'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%complement_status%' and pg_get_constraintdef(oid) like '%no_capacity%'
      and pg_get_constraintdef(oid) like '%''error''%'
  ) as contrainte_complement,
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.product_searches'::regclass and conname = 'product_searches_served_from_cache_check'
      and pg_get_constraintdef(oid) like '%served_from_cache%' and pg_get_constraintdef(oid) like '%lens_from_cache%'
  ) as contrainte_cache_servi,
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.product_searches'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%shopping_calls%'
  ) as contrainte_appels,
  coalesce((
    select bool_and(pg_get_functiondef(p.oid) like '%served_from_cache%') from pg_proc p
    where p.proname = 'serpapi_quota' and p.pronamespace = 'public'::regnamespace
  ), false) as quota_sans_cache;
