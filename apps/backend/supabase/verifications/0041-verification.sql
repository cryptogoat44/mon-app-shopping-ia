-- Vérification de la migration 0041 (alertes prix et stock, nouvelle version).
-- Lecture seule. À lancer sur la base où la migration vient d'être appliquée
-- (spotto-dev-2 seulement, tant que le fondateur ne décide pas autre chose).
--
-- Résultat attendu : une seule ligne, true | true | true | true | true | true, soit :
--   sonde = true : wish_alerts_version répond 3 (le serveur allume les alertes) ;
--   colonnes = true : « Aider les autres membres » (profiles.help_others), le
--     seuil sur la cloche, la série des signalements et le jour d'envoi sont là ;
--   jours_seulement = true : plus aucune heure de création ni d'envoi
--     (wish_alert_events.created_at, send_after, sent_at, wish_watches.last_sent_*_at,
--     wish_tracking.ref_*) ;
--   reservation_effacee = true : aucune alerte close ne garde d'heure de
--     réservation, et la règle de la base l'interdit ;
--   aucune_origine = true : aucune colonne d'alerte ne désigne une recherche,
--     un signalement ou un membre à l'origine ;
--   fonctions_serveur_seul = true : les six fonctions de 0041 existent, et seul
--     le serveur peut les appeler.
select
  wish_alerts_version() = 3 as sonde,
  (select count(*) from information_schema.columns
     where table_schema = 'public'
       and ((table_name = 'profiles' and column_name = 'help_others')
         or (table_name = 'wish_watches' and column_name in ('target_price', 'target_currency', 'target_country', 'below_target'))
         or (table_name = 'stock_reports' and column_name in ('in_streak', 'helps_others'))
         or (table_name = 'wish_alert_events' and column_name = 'sent_on'))) = 8 as colonnes,
  not exists (select 1 from information_schema.columns
               where table_schema = 'public'
                 and ((table_name = 'wish_alert_events' and column_name in ('created_at', 'send_after', 'sent_at'))
                   or (table_name = 'wish_watches' and column_name like 'last\_sent\_%')
                   or (table_name = 'wish_tracking' and column_name like 'ref\_%'))) as jours_seulement,
  exists (select 1 from pg_constraint
           where conrelid = 'public.wish_alert_events'::regclass and conname = 'wish_alert_events_lease_cleared_check')
    and not exists (select 1 from wish_alert_events where status <> 'pending' and (claimed_at is not null or pushing_at is not null)) as reservation_effacee,
  not exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'wish_alert_events'
                 and column_name ~ '(search|report|observer|searcher|buyer|source|match|merchant|url)') as aucune_origine,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('wish_alerts_version', 'wish_observe', 'wish_stock_report', 'wish_alerts_claim', 'wish_alerts_mark_sent', 'wish_alerts_purge')
       and has_function_privilege('service_role', p.oid, 'execute')
       and not has_function_privilege('anon', p.oid, 'execute')
       and not has_function_privilege('authenticated', p.oid, 'execute')) = 6 as fonctions_serveur_seul;
