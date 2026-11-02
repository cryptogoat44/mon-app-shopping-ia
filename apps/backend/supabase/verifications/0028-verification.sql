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

