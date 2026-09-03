-- ============================================================
-- Correctif : à la création du projet, "Automatically expose new
-- tables" a été désactivé par choix de sécurité (RLS strict par
-- défaut). Effet de bord non anticipé : ce réglage bloque aussi les
-- droits de la clé service_role sur les tables, alors qu'elle est
-- censée avoir un accès complet (elle contourne RLS par conception,
-- c'est déjà elle notre seule barrière d'accès côté serveur).
-- Ce correctif accorde explicitement tous les droits à service_role,
-- sur les tables déjà créées et sur celles à venir.
-- ============================================================
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;

alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
