-- Vérification de la migration 0034 (modération des collections). Lecture
-- seule. À lancer sur la base où la migration vient d'être appliquée
-- (spotto-dev-2, puis la production).
--
-- Résultat attendu : une seule ligne, true | true | true | true | true | true, soit :
--   signalement_collection = true : une collection peut être signalée (reports)
--     et faire l'objet d'une décision (moderation_actions) ;
--   collection_masquable = true : collections.hidden_at existe ;
--   copie_retirable = true : collection_image_copies.image_removed_at existe, et
--     une copie retirée n'a plus d'adresse (contrôle des deux adresses) ;
--   decisions_collection = true : moderation_apply et moderation_set_hidden
--     savent masquer et rétablir une collection ;
--   masquage_automatique = true : moderation_auto_hide compte aussi les collections ;
--   retrait_image = true : moderation_remove_collection_image existe, réservée
--     au serveur (ni les visiteurs ni les comptes connectés ne peuvent l'appeler).
select
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.reports'::regclass and conname = 'reports_target_type_check'
      and pg_get_constraintdef(oid) like '%collection%'
  ) and exists (
    select 1 from pg_constraint
    where conrelid = 'public.moderation_actions'::regclass and conname = 'moderation_actions_target_type_check'
      and pg_get_constraintdef(oid) like '%collection%'
  ) as signalement_collection,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'collections' and column_name = 'hidden_at'
  ) as collection_masquable,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'collection_image_copies' and column_name = 'image_removed_at'
  ) and exists (
    select 1 from pg_constraint
    where conrelid = 'public.collection_image_copies'::regclass and conname = 'collection_image_copies_removed_check'
  ) as copie_retirable,
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'moderation_apply' and p.prosrc like '%from collections k%'
  ) and exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'moderation_set_hidden' and p.prosrc like '%update collections%'
  ) as decisions_collection,
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'moderation_auto_hide' and p.prosrc like '%from collections k%'
  ) as masquage_automatique,
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'moderation_remove_collection_image'
  ) and not has_function_privilege('authenticated', 'public.moderation_remove_collection_image(uuid, uuid, uuid, text)', 'execute')
    and not has_function_privilege('anon', 'public.moderation_remove_collection_image(uuid, uuid, uuid, text)', 'execute') as retrait_image;
