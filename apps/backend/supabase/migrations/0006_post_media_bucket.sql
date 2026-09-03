-- ============================================================
-- Bloc 5 — bucket de stockage pour les photos publiées sur le
-- profil (posts "lifestyle"). Public, même logique que
-- "vault-media" : l'accès réel est contrôlé par notre backend, qui
-- ne renvoie un post que si son réglage de confidentialité
-- l'autorise pour le visiteur.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('post-media', 'post-media', true)
on conflict (id) do nothing;
