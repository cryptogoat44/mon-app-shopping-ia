-- Vérification de la migration 0032 (messages privés). Lecture seule. À
-- lancer sur la base où la migration vient d'être appliquée (spotto-dev-2,
-- puis la production).
--
-- Résultat attendu : une seule ligne, true | true | true | true | true | true | true, soit :
--   tables = true : conversations, conversation_participants et messages existent ;
--   protegees = true : RLS active sur les trois, sans aucune règle d'accès
--     public (seul le serveur, avec sa clé secrète, les lit et les écrit) ;
--   fermees_au_public = true : ni les visiteurs ni les comptes connectés ne
--     peuvent lire ces tables ;
--   reglage_ecrire = true : profiles.messages_from (« Qui peut m'écrire ») existe ;
--   apercu_automatique = true : le déclencheur qui tient à jour l'aperçu et le « non lu » existe ;
--   signalement_message = true : un message peut être signalé (reports) ;
--   decision_message = true : moderation_apply et moderation_set_hidden savent masquer un message.
select
  (select count(*) from pg_tables where schemaname = 'public'
     and tablename in ('conversations', 'conversation_participants', 'messages')) = 3 as tables,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('conversations', 'conversation_participants', 'messages') and c.relrowsecurity) = 3
    and not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename in ('conversations', 'conversation_participants', 'messages')) as protegees,
  not has_table_privilege('anon', 'public.messages', 'select')
    and not has_table_privilege('authenticated', 'public.messages', 'select')
    and not has_table_privilege('authenticated', 'public.conversations', 'select')
    and not has_table_privilege('authenticated', 'public.conversation_participants', 'select') as fermees_au_public,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'messages_from'
  ) as reglage_ecrire,
  exists (select 1 from pg_trigger where tgname = 'messages_after_insert' and not tgisinternal) as apercu_automatique,
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.reports'::regclass and conname = 'reports_target_type_check'
      and pg_get_constraintdef(oid) like '%message%'
  ) as signalement_message,
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'moderation_apply' and p.prosrc like '%from messages m%'
  ) and exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'moderation_set_hidden' and p.prosrc like '%update messages%'
  ) as decision_message;
