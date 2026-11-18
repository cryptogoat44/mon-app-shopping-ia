-- Vérification de la migration 0043 (confirmations de lecture des messages
-- privés). Lecture seule. À lancer sur la base où la migration vient d'être
-- appliquée (spotto-dev-2, puis la production).
--
-- Résultat attendu : une seule ligne, true | true | true | true | true | true, soit :
--   reglage = true : profiles.read_receipts existe (oui ou non, jamais vide) ;
--   allume_par_defaut = true : sans choix du membre, le réglage vaut « oui » ;
--   depuis = true : profiles.read_receipts_since existe (une date, jamais
--     vide) : le moment à partir duquel les lectures d'un membre peuvent être
--     montrées ;
--   depuis_la_creation = true : pour un nouveau membre, ce moment est la
--     création de son profil ;
--   lecture_datee = true : la date de la dernière lecture de chaque
--     conversation (conversation_participants.last_read_at, migration 0032)
--     est là ;
--   fermee_au_public = true : profiles garde sa RLS active, sans aucune règle
--     d'accès public (seul le serveur, avec sa clé secrète, lit ce réglage).
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'read_receipts'
      and data_type = 'boolean' and is_nullable = 'NO'
  ) as reglage,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'read_receipts'
      and column_default = 'true'
  ) as allume_par_defaut,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'read_receipts_since'
      and data_type = 'timestamp with time zone' and is_nullable = 'NO'
  ) as depuis,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'read_receipts_since'
      and column_default = 'now()'
  ) as depuis_la_creation,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'conversation_participants' and column_name = 'last_read_at'
  ) as lecture_datee,
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'profiles')
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles') as fermee_au_public;
