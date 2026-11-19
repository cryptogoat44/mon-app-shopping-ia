-- Vérification de la migration 0044 (messages, plus de confort : aimer un
-- message, y répondre, le supprimer, envoyer une publication). Lecture
-- seule. À lancer sur la base où la migration vient d'être appliquée
-- (spotto-dev-2, puis la production).
--
-- Résultat attendu : une seule ligne, true | true | true | true | true | true | true, soit :
--   colonnes = true : messages a ses cinq nouvelles colonnes (reply_to_id,
--     post_id, shared_post, deleted_at, updated_at), du bon type ;
--   liens = true : reply_to_id et post_id sont vidés quand le message cité
--     ou la publication disparaît (jamais une suppression en cascade) ;
--   jaime = true : la table message_reactions existe, un « j'aime » par
--     membre et par message, supprimé avec le message ou le compte ;
--   regle = true : la nouvelle règle messages_content_check est là (texte,
--     envie jointe, publication envoyée ou message supprimé) ;
--   ancienne_regle_retiree = true : l'ancienne règle de 0032 (texte ou envie
--     jointe seulement) n'y est plus ;
--   index = true : les quatre index de la migration existent ;
--   fermee_au_public = true : message_reactions et messages ont leur RLS
--     active, sans aucune règle d'accès public, et ni les visiteurs ni les
--     comptes connectés n'ont de droit sur message_reactions.
select
  (select count(*) = 5 from information_schema.columns
     where table_schema = 'public' and table_name = 'messages'
       and (column_name, data_type, is_nullable) in (
         ('reply_to_id', 'uuid', 'YES'),
         ('post_id', 'uuid', 'YES'),
         ('shared_post', 'boolean', 'NO'),
         ('deleted_at', 'timestamp with time zone', 'YES'),
         ('updated_at', 'timestamp with time zone', 'YES')
       )) as colonnes,
  (select count(*) = 2 from pg_constraint c
     where c.conrelid = 'public.messages'::regclass and c.contype = 'f' and c.confdeltype = 'n'
       and c.confrelid in ('public.messages'::regclass, 'public.posts'::regclass)
       and exists (
         select 1 from pg_attribute a
         where a.attrelid = c.conrelid and a.attnum = any (c.conkey) and a.attname in ('reply_to_id', 'post_id')
       )) as liens,
  to_regclass('public.message_reactions') is not null
    and (select count(*) = 2 from pg_constraint c
           where c.conrelid = to_regclass('public.message_reactions') and c.contype = 'f' and c.confdeltype = 'c')
    and exists (select 1 from pg_constraint c
                  where c.conrelid = to_regclass('public.message_reactions') and c.contype = 'p' and cardinality(c.conkey) = 2) as jaime,
  exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.messages'::regclass and c.conname = 'messages_content_check'
      and regexp_replace(lower(pg_get_constraintdef(c.oid)), '[\s()]', '', 'g')
          = 'checkbodyisnotnullorwish_titleisnotnullorshared_postordeleted_atisnotnull'
  ) as regle,
  not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.messages'::regclass and c.contype = 'c'
      and regexp_replace(lower(pg_get_constraintdef(c.oid)), '[\s()]', '', 'g') = 'checkbodyisnotnullorwish_titleisnotnull'
  ) as ancienne_regle_retiree,
  (select count(*) = 4 from pg_indexes
     where schemaname = 'public'
       and indexname in ('messages_reply_to_idx', 'messages_post_idx', 'messages_changed_idx', 'message_reactions_user_idx')) as index,
  (select bool_and(c.relrowsecurity) and count(*) = 2 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('messages', 'message_reactions'))
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('messages', 'message_reactions'))
    and not exists (
      select 1 from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'message_reactions' and grantee in ('PUBLIC', 'anon', 'authenticated')
    ) as fermee_au_public;
