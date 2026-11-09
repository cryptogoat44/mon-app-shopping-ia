-- Vérification de la migration 0036 (alertes prix et stock). Lecture seule.
-- À lancer sur la base où la migration vient d'être appliquée (spotto-dev-2
-- seulement, tant que le fondateur ne décide pas autre chose).
--
-- Résultat attendu : une seule ligne, true | true | true | true | true | true | true | true, soit :
--   tables = true : wish_tracking, wish_watches, wish_alert_events et stock_reports existent ;
--   colonnes = true : profiles.price_alerts_enabled (coupé par défaut),
--     push_tokens.notify_messages (allumé par défaut) et
--     push_tokens.notify_alerts (coupé par défaut) existent, ainsi que
--     wish_alert_events.pushing_at (une alerte peut-être envoyée n'est jamais renvoyée) ;
--   protegees = true : RLS active sur les quatre tables, sans aucune règle
--     d'accès public (seul le serveur, avec sa clé secrète, les lit et les écrit) ;
--   fermees_au_public = true : ni les visiteurs ni les comptes connectés ne
--     peuvent les lire ; le serveur, oui ;
--   meme_membre = true : la base vérifie que le suivi, la cloche et les
--     alertes sont au même membre que l'envie (clés étrangères à deux colonnes) ;
--   suppression_en_cascade = true : tout part avec l'envie et avec le compte ;
--   aucun_auteur = true : aucune colonne ne garde l'auteur d'une recherche,
--     l'acheteur, la proposition observée ni une adresse ;
--   fonctions_serveur_seul = true : les huit fonctions existent, et seul le
--     serveur peut les appeler.
select
  (select count(*) from pg_tables where schemaname = 'public'
     and tablename in ('wish_tracking', 'wish_watches', 'wish_alert_events', 'stock_reports')) = 4 as tables,
  exists (select 1 from information_schema.columns
           where table_schema = 'public' and table_name = 'profiles' and column_name = 'price_alerts_enabled'
             and is_nullable = 'NO' and column_default = 'false')
    and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'push_tokens' and column_name = 'notify_messages'
                   and is_nullable = 'NO' and column_default = 'true')
    and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'push_tokens' and column_name = 'notify_alerts'
                   and is_nullable = 'NO' and column_default = 'false')
    and exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'wish_alert_events' and column_name = 'pushing_at') as colonnes,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('wish_tracking', 'wish_watches', 'wish_alert_events', 'stock_reports') and c.relrowsecurity) = 4
    and not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename in ('wish_tracking', 'wish_watches', 'wish_alert_events', 'stock_reports')) as protegees,
  not has_table_privilege('anon', 'public.wish_tracking', 'select')
    and not has_table_privilege('authenticated', 'public.wish_tracking', 'select')
    and not has_table_privilege('authenticated', 'public.wish_watches', 'select')
    and not has_table_privilege('authenticated', 'public.wish_alert_events', 'select')
    and not has_table_privilege('authenticated', 'public.stock_reports', 'select')
    and has_table_privilege('service_role', 'public.wish_alert_events', 'select')
    and has_table_privilege('service_role', 'public.stock_reports', 'delete') as fermees_au_public,
  (select count(*) from pg_constraint
     where contype = 'f' and confrelid = 'public.wishlist_items'::regclass and array_length(conkey, 1) = 2
       and conrelid in ('public.wish_tracking'::regclass, 'public.wish_watches'::regclass, 'public.wish_alert_events'::regclass)) = 3
    as meme_membre,
  (select count(*) from pg_constraint
     where contype = 'f' and confdeltype = 'c'
       and conrelid in ('public.wish_tracking'::regclass, 'public.wish_watches'::regclass,
                        'public.wish_alert_events'::regclass, 'public.stock_reports'::regclass)) >= 7
    as suppression_en_cascade,
  not exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name in ('wish_tracking', 'wish_watches', 'wish_alert_events')
                 and (column_name like '%url%' or column_name in ('searcher_id', 'buyer_id', 'reporter_id', 'product_match_id', 'search_id')))
    and not exists (select 1 from information_schema.columns
                     where table_schema = 'public' and table_name = 'stock_reports' and column_name like '%url%') as aucun_auteur,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('wish_alerts_version', 'wish_observe', 'wish_alerts_claim', 'wish_alerts_mark_pushing',
                         'wish_alerts_mark_sent', 'wish_alerts_release', 'wish_stock_report', 'wish_alerts_purge')
       and has_function_privilege('service_role', p.oid, 'execute')
       and not has_function_privilege('anon', p.oid, 'execute')
       and not has_function_privilege('authenticated', p.oid, 'execute')) = 8 as fonctions_serveur_seul;
