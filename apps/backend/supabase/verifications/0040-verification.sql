-- Vérification de la migration 0040 (garde-fous des alertes prix et stock).
-- Lecture seule. À lancer sur la base où la migration vient d'être appliquée
-- (spotto-dev-2 seulement, tant que le fondateur ne décide pas autre chose).
--
-- Résultat attendu : une seule ligne, true | true | true | true | true, soit :
--   sonde = true : wish_alerts_version répond 2 (le serveur allume les alertes) ;
--   colonnes = true : wish_tracking a sold_out_source, member_country et bought_on ;
--   origine_epuisee = true : chaque « épuisée » a une origine ('shop' ou
--     'members'), et seulement lui (règle de la base, aucune ligne hors règle) ;
--   un_seul_auteur = true : « Plus disponible » compte les auteurs différents
--     avant de toucher les envies des autres membres ;
--   fonctions_serveur_seul = true : wish_mark_bought et les quatre fonctions
--     remplacées existent, et seul le serveur peut les appeler.
select
  wish_alerts_version() = 2 as sonde,
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'wish_tracking'
       and column_name in ('sold_out_source', 'member_country', 'bought_on')) = 3 as colonnes,
  exists (select 1 from pg_constraint
           where conrelid = 'public.wish_tracking'::regclass and conname = 'wish_tracking_sold_out_source_check')
    and not exists (select 1 from wish_tracking where (stock_state = 'sold_out') <> (sold_out_source is not null)) as origine_epuisee,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname = 'wish_stock_report'
             and p.prosrc like '%count(distinct r.user_id)%' and p.prosrc like '%v_reporters >= 2 or t.user_id = p_user_id%') as un_seul_auteur,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('wish_alerts_version', 'wish_observe', 'wish_alerts_claim', 'wish_stock_report', 'wish_mark_bought')
       and has_function_privilege('service_role', p.oid, 'execute')
       and not has_function_privilege('anon', p.oid, 'execute')
       and not has_function_privilege('authenticated', p.oid, 'execute')) = 5 as fonctions_serveur_seul;
