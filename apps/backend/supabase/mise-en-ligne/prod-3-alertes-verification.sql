-- Vérification (lecture seule) de prod-3-alertes-production.sql. À coller
-- dans l'éditeur SQL de Supabase (spotto-prod), puis « Run ».
-- Résultat attendu : 3 lignes (0036, 0040, 0041), toutes avec
-- tout_est_bon = true et a_regarder vide. Une ligne à false (a_regarder
-- nomme alors les contrôles en défaut) ou une erreur (« … does not exist » :
-- le fichier de production n'est pas passé) : copier le résultat à Claude,
-- ne rien relancer à la main.
-- Les contrôles sont ceux de supabase/verifications/0036-verification.sql,
-- 0040-verification.sql et 0041-verification.sql (leur détail y est
-- écrit), regardés sur l'état final, après 0041. Deux contrôles de 0040
-- décrivent un état que 0041 remplace, ils changent donc ici :
--   - sa sonde (wish_alerts_version = 2) : la ligne 0041 attend 3 ;
--   - un_seul_auteur devient un_membre_seul : avec 0041, « Plus disponible »
--     ne touche les envies des autres membres qu'à partir de 3 membres
--     différents d'affilée (au lieu de 2) ; avant, seules les envies de qui
--     signale passent « épuisée ».

select '0036' as migration,
  not exists (select 1 from json_each_text(row_to_json(t)) where value is distinct from 'true') as tout_est_bon,
  coalesce((select string_agg(key, ', ') from json_each_text(row_to_json(t)) where value is distinct from 'true'), '') as a_regarder
from (
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
       and not has_function_privilege('authenticated', p.oid, 'execute')) = 8 as fonctions_serveur_seul
) t
union all
select '0040' as migration,
  not exists (select 1 from json_each_text(row_to_json(t)) where value is distinct from 'true') as tout_est_bon,
  coalesce((select string_agg(key, ', ') from json_each_text(row_to_json(t)) where value is distinct from 'true'), '') as a_regarder
from (
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'wish_tracking'
       and column_name in ('sold_out_source', 'member_country', 'bought_on')) = 3 as colonnes,
  exists (select 1 from pg_constraint
           where conrelid = 'public.wish_tracking'::regclass and conname = 'wish_tracking_sold_out_source_check')
    and not exists (select 1 from wish_tracking where (stock_state = 'sold_out') <> (sold_out_source is not null)) as origine_epuisee,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'wish_stock_report'
             and p.prosrc like '%count(distinct r.user_id)%' and p.prosrc like '%v_reporters >= 3%'
             and p.prosrc like '%t.user_id = p_user_id%') as un_membre_seul,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('wish_alerts_version', 'wish_observe', 'wish_alerts_claim', 'wish_stock_report', 'wish_mark_bought')
       and has_function_privilege('service_role', p.oid, 'execute')
       and not has_function_privilege('anon', p.oid, 'execute')
       and not has_function_privilege('authenticated', p.oid, 'execute')) = 5 as fonctions_serveur_seul
) t
union all
select '0041' as migration,
  not exists (select 1 from json_each_text(row_to_json(t)) where value is distinct from 'true') as tout_est_bon,
  coalesce((select string_agg(key, ', ') from json_each_text(row_to_json(t)) where value is distinct from 'true'), '') as a_regarder
from (
select
  wish_alerts_version() = 3 as sonde,
  (select count(*) from information_schema.columns
     where table_schema = 'public'
       and ((table_name = 'profiles' and column_name = 'help_others')
         or (table_name = 'wish_watches' and column_name in ('target_price', 'target_currency', 'target_country', 'below_target'))
         or (table_name = 'stock_reports' and column_name in ('in_streak', 'helps_others', 'country'))
         or (table_name = 'wish_alert_events' and column_name = 'sent_on'))) = 9 as colonnes,
  not exists (select 1 from information_schema.columns
               where table_schema = 'public'
                 and ((table_name = 'wish_alert_events' and column_name in ('created_at', 'send_after', 'sent_at'))
                   or (table_name = 'wish_watches' and column_name like 'last\_sent\_%')
                   or (table_name = 'wish_tracking' and column_name like 'ref\_%')))
    and not exists (select 1 from wish_tracking where merchant_key is not null) as jours_seulement,
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
       and not has_function_privilege('authenticated', p.oid, 'execute')) = 6
    and to_regprocedure('public.wish_observe(jsonb, timestamptz)') is null
    and to_regprocedure('public.wish_stock_report(uuid, text, text, integer, timestamptz)') is null as fonctions_serveur_seul
) t;
