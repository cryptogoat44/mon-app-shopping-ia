-- Vérification de la migration 0058 (étagères des amis : « Montrer mes Envies
-- à mes amis », « Montrer mon Vault à mes amis »). Lecture seule. À lancer sur
-- la base où la migration vient d'être appliquée (spotto-dev-2, puis la
-- production).
--
-- Résultat attendu : une seule ligne, true | true | true | true, soit :
--   reglage_envies = true : profiles.wishes_shown_to_friends existe (oui /
--     non, jamais vide, faux par défaut) ;
--   reglage_vault = true : profiles.vault_shown_to_friends existe (oui / non,
--     jamais vide, faux par défaut) ;
--   personne_montre = true : aucun membre n'est montré à ses amis du seul fait
--     de la migration (à lire juste après l'avoir appliquée : ensuite, des
--     membres auront pu allumer un réglage, et « false » est alors normal) ;
--   protegee = true : profiles garde sa RLS active, sans aucune règle d'accès
--     public (les nouvelles colonnes ne sont lues que par le serveur).
-- Avant la migration (ou sans elle) : false | false | false | true, sans
-- erreur (protegee ne dépend pas de 0058).
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'wishes_shown_to_friends'
      and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false'
  ) as reglage_envies,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'vault_shown_to_friends'
      and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false'
  ) as reglage_vault,
  -- Avant la migration : faux (jamais une erreur pour une colonne absente).
  case when (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name in ('wishes_shown_to_friends', 'vault_shown_to_friends')
  ) < 2 then false else
  (select count(*) = 0 from profiles
     where (to_jsonb(profiles) ->> 'wishes_shown_to_friends') <> 'false'
        or (to_jsonb(profiles) ->> 'vault_shown_to_friends') <> 'false') end as personne_montre,
  coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'profiles'), false)
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profiles') as protegee;
