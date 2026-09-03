-- ============================================================
-- Bloc 2 — bucket de stockage privé pour les captures d'écran
-- envoyées en repli quand l'analyse de la miniature ne suffit pas.
-- Privé : seul le backend (clé service_role) y accède, via une URL
-- signée à courte durée de vie transmise à l'API de recherche visuelle.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('screenshots', 'screenshots', false)
on conflict (id) do nothing;
