-- Vérification de la migration 0037 (modération des profils : retirer une
-- bio ou une photo de profil). Lecture seule. À lancer sur la base où la
-- migration vient d'être appliquée (spotto-dev-2, puis la production).
--
-- Résultat attendu : une seule ligne, true | true | true, soit :
--   decisions_profil = true : le journal de la modération (moderation_actions)
--     accepte les décisions « remove_bio » et « remove_avatar » ;
--   retrait_profil = true : la fonction moderation_remove_profile_part existe,
--     vide la bio ou l'adresse de la photo et prévient la personne ;
--   reservee_au_serveur = true : ni les visiteurs ni les comptes connectés ne
--     peuvent l'appeler.
select
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.moderation_actions'::regclass and conname = 'moderation_actions_action_check'
      and pg_get_constraintdef(oid) like '%remove_bio%'
      and pg_get_constraintdef(oid) like '%remove_avatar%'
  ) as decisions_profil,
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'moderation_remove_profile_part'
      and p.prosrc like '%update profiles set bio = null%'
      and p.prosrc like '%update profiles set avatar_url = null%'
      and p.prosrc like '%insert into notifications%'
  ) as retrait_profil,
  not has_function_privilege('authenticated', 'public.moderation_remove_profile_part(uuid, uuid, text, text, text)', 'execute')
    and not has_function_privilege('anon', 'public.moderation_remove_profile_part(uuid, uuid, text, text, text)', 'execute') as reservee_au_serveur;
