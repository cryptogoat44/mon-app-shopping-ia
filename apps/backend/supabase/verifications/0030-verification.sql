-- Vérification de la migration 0030 (chantier 3 : masquage automatique après
-- plusieurs signalements). Lecture seule. À lancer sur la base où la
-- migration vient d'être appliquée (spotto-dev-2, puis la production).
--
-- Résultat attendu : une seule ligne, true | true | true | true | true, soit :
--   colonne_automatique = true : le journal sait qu'une décision est automatique ;
--   fonction_masquage = true : moderation_auto_hide existe ;
--   fonction_decision = true : moderation_apply connaît le masquage automatique ;
--   reservees_au_serveur = true : ni les visiteurs ni les comptes connectés ne
--     peuvent appeler ces deux fonctions (seul le serveur, avec sa clé secrète) ;
--   index_signalements = true : l'index des signalements d'une personne.
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'moderation_actions' and column_name = 'automatic'
  ) as colonne_automatique,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'moderation_auto_hide') as fonction_masquage,
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'moderation_apply' and p.prosrc like '%v_auto%'
  ) as fonction_decision,
  not has_function_privilege('anon', 'public.moderation_auto_hide(text, uuid, integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.moderation_auto_hide(text, uuid, integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.moderation_apply(uuid, text, text, uuid, text, text)', 'execute') as reservees_au_serveur,
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'reports_reporter_id_target_type_idx') as index_signalements;
