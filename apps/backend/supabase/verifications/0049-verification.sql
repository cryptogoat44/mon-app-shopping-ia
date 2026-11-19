-- Vérification de la migration 0049 (épingles et lien en bio). Lecture seule.
-- À lancer sur la base où la migration vient d'être appliquée (spotto-dev-2,
-- puis la production).
--
-- Résultat attendu : une seule ligne, true | true | true | true | true, soit :
--   epingles = true : posts.pinned_at existe (une date, vide par défaut), avec
--     son index sur les seules publications épinglées ;
--   aucune_epingle = true : aucune publication n'est épinglée du seul fait de
--     la migration (à lire juste après l'avoir appliquée : ensuite, des
--     membres auront pu épingler, et « false » est alors normal) ;
--   lien = true : profiles.link_url existe (un texte, vide par défaut) ;
--   lien_controle = true : la base refuse un lien qui ne commence pas par
--     « https:// », qui contient un espace ou qui dépasse 200 caractères ;
--   protegees = true : posts et profiles gardent leur RLS active, sans aucune
--     règle d'accès public (les nouvelles colonnes ne sont lues que par le
--     serveur).
-- Avant la migration (ou sans elle) : false | false | false | false | true,
-- sans erreur (protegees ne dépend pas de 0049).
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'posts' and column_name = 'pinned_at'
      and data_type = 'timestamp with time zone' and is_nullable = 'YES' and column_default is null
  )
    and exists (
      select 1 from pg_indexes
      where schemaname = 'public' and tablename = 'posts' and indexname = 'posts_pinned_idx'
        and indexdef like '%(user_id, pinned_at DESC)%' and indexdef like '%WHERE (pinned_at IS NOT NULL)%'
    ) as epingles,
  -- Avant la migration : faux (jamais une erreur pour une colonne absente).
  case when not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'posts' and column_name = 'pinned_at'
  ) then false else
  (select count(*) = 0 from posts where (to_jsonb(posts) ->> 'pinned_at') is not null) end as aucune_epingle,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'link_url'
      and data_type = 'text' and is_nullable = 'YES' and column_default is null
  ) as lien,
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and conname = 'profiles_link_url_check' and contype = 'c'
      and pg_get_constraintdef(oid) like '%char_length(link_url) <= 200%'
      and pg_get_constraintdef(oid) like '%^https://[^[:space:]]+$%'
  ) as lien_controle,
  coalesce((select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('posts', 'profiles')), false)
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('posts', 'profiles')) as protegees;
