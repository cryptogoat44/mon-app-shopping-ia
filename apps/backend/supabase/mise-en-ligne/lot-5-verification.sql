-- Vérification de la mise en ligne du lot 5 (migrations 0022, 0023, 0024).
-- Lecture seule : peut être lancée autant de fois que nécessaire, sur la
-- production comme sur spotto-dev.
-- Résultat attendu : une seule ligne, toutes les colonnes à true.

select
  -- 0022 : table des appels SerpApi (protégée), fonction du plafond.
  exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'serpapi_calls') as plafond_table,
  exists (select 1 from pg_proc where proname = 'serpapi_quota') as plafond_fonction,
  -- 0023 : administrateurs, journal des décisions, suspensions — protégés, sans règle d'accès public.
  (select count(*) = 3 from pg_tables where schemaname = 'public' and tablename in ('admins', 'moderation_actions', 'suspensions')) as moderation_tables,
  (select count(*) = 0 from pg_policies where schemaname = 'public' and tablename in ('admins', 'moderation_actions', 'suspensions', 'serpapi_calls', 'piece_sends')) as aucune_regle_publique,
  (
    select count(*) = 3 from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'posts' and column_name = 'hidden_at')
        or (table_name = 'reports' and column_name = 'handled_at')
        or (table_name = 'notifications' and column_name = 'moderation_action_id'))
  ) as moderation_colonnes,
  -- 0024 : type « envie », pièces envoyées, réglage, notifications, modération d'une pièce.
  exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'post_type' and e.enumlabel = 'wish'
  ) as partage_type_envie,
  exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'piece_sends') as partage_table,
  (
    select count(*) = 3 from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'posts' and column_name = 'wishlist_item_id')
        or (table_name = 'profiles' and column_name = 'piece_sends_from')
        or (table_name = 'notifications' and column_name = 'piece_send_id'))
  ) as partage_colonnes,
  coalesce((select bool_and(pg_get_functiondef(p.oid) like '%piece_sends%') from pg_proc p where p.proname = 'moderation_set_hidden'), false) as partage_moderation,
  -- RLS active sur toutes les nouvelles tables.
  (
    select count(*) = 5 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relrowsecurity
      and c.relname in ('serpapi_calls', 'admins', 'moderation_actions', 'suspensions', 'piece_sends')
  ) as protection_active;
