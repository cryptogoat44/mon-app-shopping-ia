-- Vérification de la migration 0053 (quotas par membre : droits
-- d'abonnement, part du mois, réserve des abonnés). Lecture seule. À lancer
-- sur la base où la migration vient d'être appliquée (spotto-dev-2, puis la
-- production).
--
-- Résultat attendu : une seule ligne, true | true | true | true | true | true, soit :
--   table_droits = true : member_entitlements existe, avec ses cinq
--     colonnes, une ligne au plus par membre et par droit (« video » ou
--     « miroir ») ;
--   suppression_en_cascade = true : ses lignes partent avec le compte ;
--   fermee_au_public = true : RLS active, aucune règle d'accès public, ni les
--     visiteurs ni les comptes connectés ne peuvent la lire ni l'écrire ; le
--     serveur, oui ;
--   aucun_declencheur = true : aucun déclencheur sur la table ;
--   fonctions_serveur_seul = true : serpapi_quota_v2 et member_quotas_version
--     existent, et seul le serveur peut les appeler ;
--   ancienne_fonction_intacte = true : serpapi_quota (0029) est toujours là,
--     une seule fois, avec ses paramètres d'avant (les serveurs plus anciens
--     l'appellent encore).
-- Chaque colonne vaut false (jamais une erreur) si ce qu'elle vérifie manque.
select
  (select count(*) = 5 from information_schema.columns
     where table_schema = 'public' and table_name = 'member_entitlements'
       and (column_name, data_type, is_nullable) in (
         ('user_id', 'uuid', 'NO'),
         ('entitlement', 'text', 'NO'),
         ('expires_at', 'timestamp with time zone', 'YES'),
         ('source', 'text', 'NO'),
         ('updated_at', 'timestamp with time zone', 'NO')
       ))
    and exists (select 1 from pg_constraint c
                  where c.conrelid = to_regclass('public.member_entitlements') and c.contype = 'p' and cardinality(c.conkey) = 2) as table_droits,
  exists (select 1 from pg_constraint c
            where c.conrelid = to_regclass('public.member_entitlements') and c.contype = 'f' and c.confdeltype = 'c'
              and c.confrelid = 'public.profiles'::regclass) as suppression_en_cascade,
  case when to_regclass('public.member_entitlements') is null then false
       else (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.member_entitlements'))
            and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'member_entitlements')
            and not exists (
              select 1
              from unnest(array['anon', 'authenticated']) as r(role),
                   unnest(array['select', 'insert', 'update', 'delete']) as p(privilege)
              where has_table_privilege(r.role, 'public.member_entitlements', p.privilege)
            )
            and has_table_privilege('service_role', 'public.member_entitlements', 'select')
            and has_table_privilege('service_role', 'public.member_entitlements', 'insert')
            and has_table_privilege('service_role', 'public.member_entitlements', 'update')
            and has_table_privilege('service_role', 'public.member_entitlements', 'delete')
  end as fermee_au_public,
  not exists (select 1 from pg_trigger t
                where t.tgrelid = to_regclass('public.member_entitlements') and not t.tgisinternal) as aucun_declencheur,
  case when to_regprocedure('public.serpapi_quota_v2(integer, integer, integer, integer, uuid, boolean, integer, integer, uuid, timestamptz)') is null
         or to_regprocedure('public.member_quotas_version()') is null then false
       else not has_function_privilege('anon', 'public.serpapi_quota_v2(integer, integer, integer, integer, uuid, boolean, integer, integer, uuid, timestamptz)', 'execute')
            and not has_function_privilege('authenticated', 'public.serpapi_quota_v2(integer, integer, integer, integer, uuid, boolean, integer, integer, uuid, timestamptz)', 'execute')
            and has_function_privilege('service_role', 'public.serpapi_quota_v2(integer, integer, integer, integer, uuid, boolean, integer, integer, uuid, timestamptz)', 'execute')
            and not has_function_privilege('anon', 'public.member_quotas_version()', 'execute')
            and not has_function_privilege('authenticated', 'public.member_quotas_version()', 'execute')
            and has_function_privilege('service_role', 'public.member_quotas_version()', 'execute')
  end as fonctions_serveur_seul,
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'serpapi_quota')
    and to_regprocedure('public.serpapi_quota(integer, integer, integer, integer, uuid, boolean, uuid, timestamptz)') is not null as ancienne_fonction_intacte;
