-- Vérification de la migration 0050 (fil « Pour vous » : réglage « Proposer
-- mon compte aux autres membres »). Lecture seule. À lancer sur la base où la
-- migration vient d'être appliquée (spotto-dev-2, puis la production).
--
-- Résultat attendu : une seule ligne, true | true | true, soit :
--   reglage = true : profiles.discoverable existe (oui / non, jamais vide,
--     vrai par défaut) ;
--   tous_proposes = true : aucun compte n'a refusé d'être proposé du seul fait
--     de la migration (à lire juste après l'avoir appliquée : ensuite, des
--     membres auront pu éteindre le réglage, et « false » est alors normal) ;
--   protegee = true : profiles garde sa RLS active, sans aucune règle d'accès
--     public (la nouvelle colonne n'est lue que par le serveur).
-- Avant la migration (ou sans elle) : false | false | true, sans erreur
-- (protegee ne dépend pas de 0050).
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'discoverable'
      and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'true'
  ) as reglage,
  -- Avant la migration : faux (jamais une erreur pour une colonne absente).
  case when not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'discoverable'
  ) then false else
  (select count(*) = 0 from profiles where (to_jsonb(profiles) ->> 'discoverable') <> 'true') end as tous_proposes,
  coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'profiles'), false)
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles') as protegee;
