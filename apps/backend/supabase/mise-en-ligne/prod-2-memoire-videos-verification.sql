-- Vérification (lecture seule) de prod-2-memoire-videos-production.sql
-- (migrations 0038 et 0039, mémoire collective des vidéos ; elles n'avaient
-- pas de fichier de vérification). À coller dans l'éditeur SQL de Supabase
-- (spotto-prod), puis « Run ».
--
-- Résultat attendu : une seule ligne, true partout, soit :
--   tables = true : video_sources, video_spots, video_spot_items et
--     video_item_confirmations existent ;
--   protegees = true : RLS active sur les quatre, sans aucune règle d'accès
--     public (seul le serveur, avec sa clé secrète, les lit et les écrit) ;
--   fermees_au_public = true : ni les visiteurs ni les comptes connectés ne
--     peuvent les lire ni les écrire ; le serveur, oui ;
--   fonctions_serveur_seul = true : les cinq fonctions de la mémoire
--     (video_memory_version, video_spot_record, video_confirm,
--     video_products, video_memory_remove) existent une fois chacune, seul
--     le serveur peut les appeler, et l'ancienne video_products à 4
--     paramètres n'existe plus ;
--   sonde_0038 = true : video_memory_version répond au moins 1 ;
--   sonde_0039 = true : elle répond au moins 2 (garde-fous de 0039 : le
--     serveur sert la mémoire) ;
--   un_spot_par_membre = true : un seul spot par membre et par vidéo (index
--     unique de 0039) ;
--   suppression_compte = true : le déclencheur du compteur des vidéos est
--     posé, s'exécute avec les droits de son propriétaire (« security
--     definer », search_path fixé) et ne s'appelle pas directement ; sans
--     cela, supprimer un compte qui a spotté une vidéo échouerait ;
--   suppression_en_cascade = true : spots et confirmations partent avec le
--     compte, spots avec la recherche, pièces avec le spot ou le résultat.
-- Une valeur à false ou une erreur (« … does not exist » : le fichier de
-- production n'est pas passé) : copier le résultat à Claude, ne rien
-- relancer à la main.
select
  (select count(*) from pg_tables where schemaname = 'public'
     and tablename in ('video_sources', 'video_spots', 'video_spot_items', 'video_item_confirmations')) = 4 as tables,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('video_sources', 'video_spots', 'video_spot_items', 'video_item_confirmations')
       and c.relrowsecurity) = 4
    and not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename in ('video_sources', 'video_spots', 'video_spot_items', 'video_item_confirmations')) as protegees,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('video_sources', 'video_spots', 'video_spot_items', 'video_item_confirmations')
       and not has_table_privilege('anon', c.oid, 'select, insert, update, delete')
       and not has_table_privilege('authenticated', c.oid, 'select, insert, update, delete')
       and has_table_privilege('service_role', c.oid, 'select')
       and has_table_privilege('service_role', c.oid, 'insert')
       and has_table_privilege('service_role', c.oid, 'delete')) = 4 as fermees_au_public,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('video_memory_version', 'video_spot_record', 'video_confirm', 'video_products', 'video_memory_remove')
       and has_function_privilege('service_role', p.oid, 'execute')
       and not has_function_privilege('anon', p.oid, 'execute')
       and not has_function_privilege('authenticated', p.oid, 'execute')) = 5
    and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public'
             and p.proname in ('video_memory_version', 'video_spot_record', 'video_confirm', 'video_products', 'video_memory_remove')) = 5
    and to_regprocedure('public.video_products(text, text, uuid, integer)') is null as fonctions_serveur_seul,
  video_memory_version() >= 1 as sonde_0038,
  video_memory_version() >= 2 as sonde_0039,
  exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'video_spots'
           and indexname = 'video_spots_source_user_key' and indexdef like 'CREATE UNIQUE INDEX%') as un_spot_par_membre,
  exists (select 1 from pg_trigger
           where tgname = 'video_spots_after_delete' and tgrelid = 'public.video_spots'::regclass and not tgisinternal
             and tgfoid = 'public.video_spots_after_delete()'::regprocedure)
    and exists (select 1 from pg_proc
                 where oid = 'public.video_spots_after_delete()'::regprocedure
                   and prosecdef and proconfig @> array['search_path=public'])
    and not has_function_privilege('anon', 'public.video_spots_after_delete()', 'execute')
    and not has_function_privilege('authenticated', 'public.video_spots_after_delete()', 'execute') as suppression_compte,
  (select count(*) from pg_constraint
     where contype = 'f' and confdeltype = 'c'
       and conrelid in ('public.video_spots'::regclass, 'public.video_spot_items'::regclass, 'public.video_item_confirmations'::regclass)) >= 8
    as suppression_en_cascade;
