-- Vérification (lecture seule) de prod-1-technique-production.sql. À coller
-- dans l'éditeur SQL de Supabase (spotto-prod), puis « Run ».
-- Résultat attendu : 3 lignes (0029, 0035, 0037), toutes avec
-- tout_est_bon = true et a_regarder vide. Une ligne à false (a_regarder
-- nomme alors les contrôles en défaut) ou une erreur (« … does not exist » :
-- le fichier de production n'est pas passé) : copier le résultat à Claude,
-- ne rien relancer à la main.
-- Les contrôles de 0035 et 0037 sont ceux de
-- supabase/verifications/0035-verification.sql et 0037-verification.sql ;
-- ceux de 0029 (qui n'avait pas de fichier de vérification) :
--   table_compteurs : ai_calls existe, avec ses quatre colonnes ;
--   protegee : RLS active, sans aucune règle d'accès public ;
--   fermee_au_public : ni les visiteurs ni les comptes connectés ne lisent
--     ni n'écrivent ai_calls ; le serveur, oui ;
--   suppression_en_cascade : les compteurs d'un compte partent avec lui ;
--   compteurs_serveur_seul : ai_quota existe, seul le serveur l'appelle ;
--   part_du_jour : serpapi_quota ne compte plus une recherche en panne dans
--     la part du jour de la personne ;
--   plafond_serveur_seul : serpapi_quota reste réservée au serveur ;
--   index : les 16 index des clés étrangères et les 2 de ai_calls existent.

select '0029' as migration,
  not exists (select 1 from json_each_text(row_to_json(t)) where value is distinct from 'true') as tout_est_bon,
  coalesce((select string_agg(key, ', ') from json_each_text(row_to_json(t)) where value is distinct from 'true'), '') as a_regarder
from (
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'ai_calls'
       and column_name in ('id', 'kind', 'user_id', 'called_at')) = 4 as table_compteurs,
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'ai_calls')
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ai_calls') as protegee,
  not has_table_privilege('anon', 'public.ai_calls', 'select')
    and not has_table_privilege('authenticated', 'public.ai_calls', 'select')
    and not has_table_privilege('authenticated', 'public.ai_calls', 'insert')
    and has_table_privilege('service_role', 'public.ai_calls', 'insert')
    and has_table_privilege('service_role', 'public.ai_calls', 'delete') as fermee_au_public,
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.ai_calls'::regclass and contype = 'f' and confdeltype = 'c'
      and confrelid = 'public.profiles'::regclass
  ) as suppression_en_cascade,
  has_function_privilege('service_role', 'public.ai_quota(text, uuid, integer, integer, boolean, timestamptz)', 'execute')
    and not has_function_privilege('anon', 'public.ai_quota(text, uuid, integer, integer, boolean, timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'public.ai_quota(text, uuid, integer, integer, boolean, timestamptz)', 'execute') as compteurs_serveur_seul,
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'serpapi_quota'
      and p.prosrc like '%and s.failure_kind is null%'
      and p.prosrc not like '%provider_refused%'
  ) as part_du_jour,
  has_function_privilege('service_role', 'public.serpapi_quota(integer, integer, integer, integer, uuid, boolean, uuid, timestamptz)', 'execute')
    and not has_function_privilege('anon', 'public.serpapi_quota(integer, integer, integer, integer, uuid, boolean, uuid, timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'public.serpapi_quota(integer, integer, integer, integer, uuid, boolean, uuid, timestamptz)', 'execute') as plafond_serveur_seul,
  (select count(*) from pg_indexes where schemaname = 'public'
     and indexname in ('affiliate_links_product_match_id_idx', 'affiliate_clicks_affiliate_link_id_idx',
                       'affiliate_conversions_affiliate_click_id_idx', 'vault_items_product_match_id_idx',
                       'vault_items_affiliate_conversion_id_idx', 'wishlist_items_product_match_id_idx',
                       'post_tagged_pieces_product_match_id_idx', 'post_tagged_pieces_vault_item_id_idx',
                       'posts_vault_item_id_idx', 'post_reactions_user_id_idx', 'notifications_actor_id_idx',
                       'notifications_post_id_idx', 'notifications_comment_id_idx', 'reports_reporter_id_idx',
                       'consents_user_id_idx', 'data_export_requests_user_id_idx',
                       'ai_calls_kind_called_at_idx', 'ai_calls_user_id_called_at_idx')) = 18 as index
) t
union all
select '0035' as migration,
  not exists (select 1 from json_each_text(row_to_json(t)) where value is distinct from 'true') as tout_est_bon,
  coalesce((select string_agg(key, ', ') from json_each_text(row_to_json(t)) where value is distinct from 'true'), '') as a_regarder
from (
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'push_tokens'
       and column_name in ('token', 'user_id', 'platform', 'created_at', 'updated_at', 'last_error')) = 6 as table_presente,
  exists (
    select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
    where c.conrelid = 'public.push_tokens'::regclass and c.contype in ('p', 'u')
      and array_length(c.conkey, 1) = 1 and a.attname = 'token'
  ) as jeton_unique,
  (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'push_tokens')
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'push_tokens') as protegee,
  not has_table_privilege('anon', 'public.push_tokens', 'select')
    and not has_table_privilege('authenticated', 'public.push_tokens', 'select')
    and not has_table_privilege('authenticated', 'public.push_tokens', 'insert')
    and has_table_privilege('service_role', 'public.push_tokens', 'select')
    and has_table_privilege('service_role', 'public.push_tokens', 'delete') as fermee_au_public,
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.push_tokens'::regclass and contype = 'f' and confdeltype = 'c'
      and confrelid = 'public.profiles'::regclass
  ) as suppression_en_cascade
) t
union all
select '0037' as migration,
  not exists (select 1 from json_each_text(row_to_json(t)) where value is distinct from 'true') as tout_est_bon,
  coalesce((select string_agg(key, ', ') from json_each_text(row_to_json(t)) where value is distinct from 'true'), '') as a_regarder
from (
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
    and not has_function_privilege('anon', 'public.moderation_remove_profile_part(uuid, uuid, text, text, text)', 'execute') as reservee_au_serveur
) t;
