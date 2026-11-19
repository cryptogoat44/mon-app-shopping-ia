-- Vérification de la migration 0046 (commentaires : réponses, « j'aime »,
-- mentions). Lecture seule. À lancer sur la base où la migration vient d'être
-- appliquée (spotto-dev-2, puis la production).
--
-- Résultat attendu : une seule ligne, true | true | true | true | true | true | true, soit :
--   reponses = true : comments.parent_id existe, facultative, désigne un
--     commentaire et s'efface avec lui ; son index est là ;
--   aucune_reponse_creee = true : aucun commentaire existant n'est devenu une
--     réponse du seul fait de la migration (à lire juste après l'avoir
--     appliquée : ensuite, des membres auront répondu, et « false » est normal) ;
--   jaime = true : comment_reactions existe, un « j'aime » par membre et par
--     commentaire, effacé avec le commentaire ou avec le compte ;
--   mentions = true : comment_mentions existe, une mention par membre et par
--     commentaire, jamais soi-même, pseudo en minuscules, effacée avec le
--     commentaire ou avec l'un des deux comptes ;
--   protegees = true : RLS active sur les deux tables, sans aucune règle
--     d'accès public ;
--   fermees_au_public = true : ni les visiteurs ni les comptes connectés ne
--     peuvent lire ni écrire ces deux tables ;
--   reglage = true : profiles.mentions_from existe, obligatoire, vaut
--     « following » au départ et n'accepte que les trois valeurs prévues.
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'comments' and column_name = 'parent_id'
      and data_type = 'uuid' and is_nullable = 'YES'
  )
    and exists (
      select 1 from pg_constraint
      where conrelid = 'public.comments'::regclass and contype = 'f'
        and confrelid = 'public.comments'::regclass and confdeltype = 'c'
    )
    and to_regclass('public.comments_parent_idx') is not null as reponses,
  not exists (select 1 from comments where parent_id is not null) as aucune_reponse_creee,
  to_regclass('public.comment_reactions') is not null
    and exists (
      select 1 from pg_constraint
      where conrelid = 'public.comment_reactions'::regclass and contype = 'p' and array_length(conkey, 1) = 2
    )
    and (select count(*) from pg_constraint
         where conrelid = 'public.comment_reactions'::regclass and contype = 'f' and confdeltype = 'c') = 2 as jaime,
  to_regclass('public.comment_mentions') is not null
    and exists (
      select 1 from pg_constraint
      where conrelid = 'public.comment_mentions'::regclass and contype = 'p' and array_length(conkey, 1) = 2
    )
    and exists (
      select 1 from pg_constraint
      where conrelid = 'public.comment_mentions'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) like '%user_id <> author_id%'
    )
    and exists (
      select 1 from pg_constraint
      where conrelid = 'public.comment_mentions'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) like '%a-z0-9_%'
    )
    and (select count(*) from pg_constraint
         where conrelid = 'public.comment_mentions'::regclass and contype = 'f' and confdeltype = 'c') = 3 as mentions,
  (select bool_and(c.relrowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('comment_reactions', 'comment_mentions'))
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('comment_reactions', 'comment_mentions')) as protegees,
  not has_table_privilege('anon', 'public.comment_reactions', 'select')
    and not has_table_privilege('authenticated', 'public.comment_reactions', 'select')
    and not has_table_privilege('authenticated', 'public.comment_reactions', 'insert')
    and not has_table_privilege('authenticated', 'public.comment_reactions', 'delete')
    and not has_table_privilege('anon', 'public.comment_mentions', 'select')
    and not has_table_privilege('authenticated', 'public.comment_mentions', 'select')
    and not has_table_privilege('authenticated', 'public.comment_mentions', 'insert')
    and not has_table_privilege('authenticated', 'public.comment_mentions', 'delete') as fermees_au_public,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'mentions_from'
      and data_type = 'text' and is_nullable = 'NO' and column_default like '''following''%'
  )
    and exists (
      select 1 from pg_constraint
      where conrelid = 'public.profiles'::regclass and conname = 'profiles_mentions_from_check'
        and pg_get_constraintdef(oid) like '%everyone%'
        and pg_get_constraintdef(oid) like '%following%'
        and pg_get_constraintdef(oid) like '%nobody%'
    ) as reglage;
