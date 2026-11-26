-- Vérification de la migration 0058 (étagères des amis : « Montrer mes Envies
-- à mes amis », « Montrer mon Vault à mes amis », allumés par défaut, et la
-- date de l'information vue). Lecture seule. À lancer sur la base où la
-- migration vient d'être appliquée (spotto-dev-2, puis la production).
--
-- Résultat attendu : une seule ligne, true | true | true | true | true, soit :
--   reglage_envies = true : profiles.wishes_shown_to_friends existe (oui /
--     non, jamais vide, vrai par défaut) ;
--   reglage_vault = true : profiles.vault_shown_to_friends existe (oui / non,
--     jamais vide, vrai par défaut) ;
--   information = true : profiles.friend_shelves_informed_at existe (une
--     date, vide par défaut) ;
--   personne_informe = true : aucun membre n'est noté « informé » du seul
--     fait de la migration, donc personne n'est encore montré à ses amis (à
--     lire juste après l'avoir appliquée : ensuite, des membres auront vu
--     l'information dans l'app, et « false » est alors normal) ;
--   protegee = true : profiles garde sa RLS active, sans aucune règle d'accès
--     public (les nouvelles colonnes ne sont lues que par le serveur).
-- Avant la migration (ou sans elle) : false | false | false | false | true,
-- sans erreur (protegee ne dépend pas de 0058).
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'wishes_shown_to_friends'
      and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'true'
  ) as reglage_envies,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'vault_shown_to_friends'
      and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'true'
  ) as reglage_vault,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'friend_shelves_informed_at'
      and data_type = 'timestamp with time zone' and is_nullable = 'YES' and column_default is null
  ) as information,
  -- Avant la migration : faux (jamais une erreur pour une colonne absente).
  case when not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'friend_shelves_informed_at'
  ) then false else
  (select count(*) = 0 from profiles
     where (to_jsonb(profiles) ->> 'friend_shelves_informed_at') is not null) end as personne_informe,
  coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'profiles'), false)
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles') as protegee;
