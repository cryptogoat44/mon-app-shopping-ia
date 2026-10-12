-- Vérification de la migration 0024 (lot 5, partage d'une envie).
-- À lancer sur la base où la migration vient d'être appliquée (spotto-dev,
-- puis la production).
--
-- Résultat attendu : une seule ligne, true | 1 | true | 0 | true | true | true | true, soit :
--   type_envie = true : le type de publication « envie » (wish) existe ;
--   table_pieces = 1 : la table des pièces envoyées (piece_sends) existe ;
--   rls_pieces = true : sa protection ligne par ligne (RLS) est active ;
--   politiques_pieces = 0 : aucune règle n'ouvre l'accès public de Supabase
--     (seul le serveur, avec sa clé secrète, la lit et l'écrit) ;
--   colonnes_ajoutees = true : posts.wishlist_item_id, profiles.piece_sends_from,
--     notifications.piece_send_id ;
--   regle_publications = true : la règle « une source par type de publication » ;
--   signalement_piece = true : une pièce envoyée peut être signalée ;
--   moderation_piece = true : la modération sait masquer une pièce envoyée.
select
  exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'post_type' and e.enumlabel = 'wish'
  ) as type_envie,
  (select count(*)::int from pg_tables where schemaname = 'public' and tablename = 'piece_sends') as table_pieces,
  coalesce((select c.relrowsecurity from pg_class c where c.oid = 'public.piece_sends'::regclass), false) as rls_pieces,
  (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'piece_sends') as politiques_pieces,
  (
    select count(*) = 3 from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'posts' and column_name = 'wishlist_item_id')
        or (table_name = 'profiles' and column_name = 'piece_sends_from')
        or (table_name = 'notifications' and column_name = 'piece_send_id'))
  ) as colonnes_ajoutees,
  exists (select 1 from pg_constraint where conname = 'posts_type_source_check') as regle_publications,
  (
    select pg_get_constraintdef(oid) like '%piece%' from pg_constraint
    where conname = 'reports_target_type_check'
  ) as signalement_piece,
  (
    select pg_get_functiondef(p.oid) like '%piece_sends%' from pg_proc p
    where p.proname = 'moderation_set_hidden'
  ) as moderation_piece;
