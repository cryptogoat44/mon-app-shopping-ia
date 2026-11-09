-- Vérification (lecture seule) de social-production.sql. À coller dans
-- l'éditeur SQL de Supabase (spotto-prod), puis « Run ».
-- Résultat attendu : 4 lignes (0030, 0032, 0033, 0034), toutes avec
-- tout_est_bon = true. Une ligne à false : copier le résultat à Claude, ne
-- rien relancer à la main. Le détail de chaque contrôle est dans
-- supabase/verifications/NNNN-verification.sql.

select '0030' as migration,
  not exists (select 1 from json_each_text(row_to_json(t)) where value is distinct from 'true') as tout_est_bon
from (
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'moderation_actions' and column_name = 'automatic'
  ) as colonne_automatique,
  exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'moderation_auto_hide') as fonction_masquage,
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'moderation_apply' and p.prosrc like '%v_auto%'
  ) as fonction_decision,
  not has_function_privilege('anon', 'public.moderation_auto_hide(text, uuid, integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.moderation_auto_hide(text, uuid, integer)', 'execute')
    and not has_function_privilege('authenticated', 'public.moderation_apply(uuid, text, text, uuid, text, text)', 'execute') as reservees_au_serveur,
  exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'reports_reporter_id_target_type_idx') as index_signalements
) t
union all
select '0032' as migration,
  not exists (select 1 from json_each_text(row_to_json(t)) where value is distinct from 'true') as tout_est_bon
from (
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
  ) as decision_message
) t
union all
select '0033' as migration,
  not exists (select 1 from json_each_text(row_to_json(t)) where value is distinct from 'true') as tout_est_bon
from (
select
  (select count(*) from pg_tables where schemaname = 'public'
     and tablename in ('collections', 'collection_items', 'collection_image_copies')) = 3 as tables,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('collections', 'collection_items', 'collection_image_copies') and c.relrowsecurity) = 3
    and not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename in ('collections', 'collection_items', 'collection_image_copies')) as protegees,
  not has_table_privilege('anon', 'public.collections', 'select')
    and not has_table_privilege('authenticated', 'public.collections', 'select')
    and not has_table_privilege('authenticated', 'public.collection_items', 'select')
    and not has_table_privilege('authenticated', 'public.collection_image_copies', 'select') as fermees_au_public,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'collections' and column_name = 'visibility'
      and column_default like '%private%'
  ) as privee_par_defaut,
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.collection_items'::regclass and contype = 'f'
      and confrelid = 'public.wishlist_items'::regclass and array_length(conkey, 1) = 2
  ) and exists (
    select 1 from pg_constraint
    where conrelid = 'public.collection_items'::regclass and contype = 'f'
      and confrelid = 'public.collections'::regclass and array_length(conkey, 1) = 2
  ) as meme_membre,
  (select count(*) from pg_constraint
     where contype = 'f' and confdeltype = 'c'
       and conrelid in ('public.collections'::regclass, 'public.collection_items'::regclass, 'public.collection_image_copies'::regclass)) >= 6
    as suppression_en_cascade
) t
union all
select '0034' as migration,
  not exists (select 1 from json_each_text(row_to_json(t)) where value is distinct from 'true') as tout_est_bon
from (
select
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.reports'::regclass and conname = 'reports_target_type_check'
      and pg_get_constraintdef(oid) like '%collection%'
  ) and exists (
    select 1 from pg_constraint
    where conrelid = 'public.moderation_actions'::regclass and conname = 'moderation_actions_target_type_check'
      and pg_get_constraintdef(oid) like '%collection%'
  ) as signalement_collection,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'collections' and column_name = 'hidden_at'
  ) as collection_masquable,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'collection_image_copies' and column_name = 'image_removed_at'
  ) and exists (
    select 1 from pg_constraint
    where conrelid = 'public.collection_image_copies'::regclass and conname = 'collection_image_copies_removed_check'
  ) as copie_retirable,
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'moderation_apply' and p.prosrc like '%from collections k%'
  ) and exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'moderation_set_hidden' and p.prosrc like '%update collections%'
  ) as decisions_collection,
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'moderation_auto_hide' and p.prosrc like '%from collections k%'
  ) as masquage_automatique,
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'moderation_remove_collection_image'
  ) and not has_function_privilege('authenticated', 'public.moderation_remove_collection_image(uuid, uuid, uuid, text)', 'execute')
    and not has_function_privilege('anon', 'public.moderation_remove_collection_image(uuid, uuid, uuid, text)', 'execute') as retrait_image
) t;
