-- Vérification de la migration 0045 (compte privé et demandes d'abonnement).
-- Lecture seule. À lancer sur la base où la migration vient d'être appliquée
-- (spotto-dev-2, puis la production).
--
-- Résultat attendu : une seule ligne, true | true | true | true | true | true, soit :
--   public_par_defaut = true : profiles.is_private existe, obligatoire, et un
--     compte est public tant que son propriétaire n'a rien changé ;
--   aucun_compte_change = true : aucun compte n'est devenu privé du seul fait
--     de la migration (à lire juste après l'avoir appliquée : ensuite, des
--     membres auront pu choisir un compte privé, et « false » est alors normal) ;
--   demandes = true : follow_requests existe, une seule demande par paire de
--     comptes, jamais à soi-même, effacée avec l'un ou l'autre compte ;
--   protegee = true : RLS active, sans aucune règle d'accès public ;
--   fermee_au_public = true : ni les visiteurs ni les comptes connectés ne
--     peuvent lire ni écrire les demandes ;
--   types_notifications = true : les notifications acceptent les cinq
--     nouveaux types, et toujours les six anciens.
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'is_private'
      and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false'
  ) as public_par_defaut,
  not exists (select 1 from profiles where is_private) as aucun_compte_change,
  to_regclass('public.follow_requests') is not null
    and exists (
      select 1 from pg_constraint
      where conrelid = 'public.follow_requests'::regclass and contype = 'p' and array_length(conkey, 1) = 2
    )
    and exists (
      select 1 from pg_constraint
      where conrelid = 'public.follow_requests'::regclass and contype = 'c'
        and pg_get_constraintdef(oid) like '%requester_id <> target_id%'
    )
    and (select count(*) from pg_constraint
         where conrelid = 'public.follow_requests'::regclass and contype = 'f'
           and confrelid = 'public.profiles'::regclass and confdeltype = 'c') = 2 as demandes,
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'follow_requests')
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'follow_requests') as protegee,
  not has_table_privilege('anon', 'public.follow_requests', 'select')
    and not has_table_privilege('authenticated', 'public.follow_requests', 'select')
    and not has_table_privilege('authenticated', 'public.follow_requests', 'insert')
    and not has_table_privilege('authenticated', 'public.follow_requests', 'delete') as fermee_au_public,
  (
    select bool_and(pg_get_constraintdef(oid) like '%''' || wanted || '''%')
    from pg_constraint,
      unnest(array['follow', 'like', 'comment', 'moderation', 'report_handled', 'piece_received',
                   'follow_request', 'follow_accepted', 'reply', 'mention', 'tag']) as wanted
    where conrelid = 'public.notifications'::regclass and conname = 'notifications_type_check'
  ) as types_notifications;
