-- Vérification de la migration 0042 (essayage virtuel photo). Lecture seule.
-- À lancer sur la base où la migration vient d'être appliquée (spotto-dev-2,
-- puis la production).
--
-- Résultat attendu : une seule ligne, true | true | true | true | true | true | true | true, soit :
--   tables = true : feature_flags, tryon_profiles, tryon_events,
--     tryon_bonus_grants, tryon_reports, tryon_alerts et tryon_usage_months existent ;
--   protegees = true : RLS active sur les sept tables, sans aucune règle
--     d'accès public (seul le serveur, avec sa clé secrète, les lit et les écrit) ;
--   fermees_au_public = true : ni les visiteurs ni les comptes connectés ne
--     peuvent les lire ni les écrire ; le serveur, oui ;
--   suppression_en_cascade = true : profil d'essayage, essais, essais
--     offerts et signalements partent avec le compte ;
--   aucune_image = true : aucune colonne d'image, de photo, d'adresse ni de
--     date de naissance dans ces tables ;
--   aucun_declencheur = true : aucun déclencheur sur ces tables (la
--     suppression d'un compte ne fait que des cascades) ;
--   fonctions_serveur_seul = true : les dix fonctions existent, et seul le
--     serveur peut les appeler ;
--   drapeau_eteint = true : le drapeau « tryon » existe et vaut false.
select
  (select count(*) from pg_tables where schemaname = 'public'
     and tablename in ('feature_flags', 'tryon_profiles', 'tryon_events', 'tryon_bonus_grants',
                       'tryon_reports', 'tryon_alerts', 'tryon_usage_months')) = 7 as tables,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relrowsecurity
       and c.relname in ('feature_flags', 'tryon_profiles', 'tryon_events', 'tryon_bonus_grants',
                         'tryon_reports', 'tryon_alerts', 'tryon_usage_months')) = 7
    and not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename in ('feature_flags', 'tryon_profiles', 'tryon_events', 'tryon_bonus_grants',
                                      'tryon_reports', 'tryon_alerts', 'tryon_usage_months')) as protegees,
  not exists (
    select 1
    from unnest(array['feature_flags', 'tryon_profiles', 'tryon_events', 'tryon_bonus_grants',
                      'tryon_reports', 'tryon_alerts', 'tryon_usage_months']) as t(name),
         unnest(array['anon', 'authenticated']) as r(role),
         unnest(array['select', 'insert', 'update', 'delete']) as p(privilege)
    where has_table_privilege(r.role, 'public.' || t.name, p.privilege)
  )
    and not exists (
      select 1
      from unnest(array['feature_flags', 'tryon_profiles', 'tryon_events', 'tryon_bonus_grants',
                        'tryon_reports', 'tryon_alerts', 'tryon_usage_months']) as t(name)
      where not has_table_privilege('service_role', 'public.' || t.name, 'select')
         or not has_table_privilege('service_role', 'public.' || t.name, 'insert')
         or not has_table_privilege('service_role', 'public.' || t.name, 'update')
         or not has_table_privilege('service_role', 'public.' || t.name, 'delete')
    ) as fermees_au_public,
  (select count(*) from pg_constraint
     where contype = 'f' and confdeltype = 'c' and confrelid = 'public.profiles'::regclass
       and conrelid in ('public.tryon_profiles'::regclass, 'public.tryon_events'::regclass,
                        'public.tryon_bonus_grants'::regclass, 'public.tryon_reports'::regclass)) = 4
    as suppression_en_cascade,
  not exists (select 1 from information_schema.columns
               where table_schema = 'public'
                 and table_name in ('feature_flags', 'tryon_profiles', 'tryon_events', 'tryon_bonus_grants',
                                    'tryon_reports', 'tryon_alerts', 'tryon_usage_months')
                 and column_name ~ '(image|photo|picture|url|birth|naissance|base64)') as aucune_image,
  not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and not t.tgisinternal
                 and c.relname in ('feature_flags', 'tryon_profiles', 'tryon_events', 'tryon_bonus_grants',
                                   'tryon_reports', 'tryon_alerts', 'tryon_usage_months')) as aucun_declencheur,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('tryon_version', 'tryon_purge', 'tryon_alert_once', 'tryon_remaining', 'tryon_reserve',
                         'tryon_complete', 'tryon_fail', 'tryon_set_age', 'tryon_reset_age', 'tryon_grant_bonus')
       and has_function_privilege('service_role', p.oid, 'execute')
       and not has_function_privilege('anon', p.oid, 'execute')
       and not has_function_privilege('authenticated', p.oid, 'execute')) = 10 as fonctions_serveur_seul,
  exists (select 1 from feature_flags where key = 'tryon' and enabled = false) as drapeau_eteint;
