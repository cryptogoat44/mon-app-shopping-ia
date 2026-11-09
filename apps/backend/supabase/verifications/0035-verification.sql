-- Vérification de la migration 0035 (appareils des notifications des
-- nouveaux messages). Lecture seule. À lancer sur la base où la migration
-- vient d'être appliquée (spotto-dev-2, puis la production).
--
-- Résultat attendu : une seule ligne, true | true | true | true | true, soit :
--   table_presente = true : push_tokens existe, avec ses six colonnes ;
--   jeton_unique = true : un jeton n'apparaît qu'une fois (clé primaire) ;
--   protegee = true : RLS active, sans aucune règle d'accès public (seul le
--     serveur, avec sa clé secrète, la lit et l'écrit) ;
--   fermee_au_public = true : ni les visiteurs ni les comptes connectés ne
--     peuvent la lire ni l'écrire ; le serveur, oui ;
--   suppression_en_cascade = true : les appareils partent avec le compte.
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'push_tokens'
       and column_name in ('token', 'user_id', 'platform', 'created_at', 'updated_at', 'last_error')) = 6 as table_presente,
  exists (
    select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.push_tokens'::regclass and c.contype in ('p', 'u')
      and array_length(c.conkey, 1) = 1 and a.attname = 'token'
  ) as jeton_unique,
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'push_tokens')
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'push_tokens') as protegee,
  not has_table_privilege('anon', 'public.push_tokens', 'select')
    and not has_table_privilege('authenticated', 'public.push_tokens', 'select')
    and not has_table_privilege('authenticated', 'public.push_tokens', 'insert')
    and has_table_privilege('service_role', 'public.push_tokens', 'select')
    and has_table_privilege('service_role', 'public.push_tokens', 'delete') as fermee_au_public,
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.push_tokens'::regclass and contype = 'f' and confdeltype = 'c'
      and confrelid = 'public.profiles'::regclass
  ) as suppression_en_cascade;
