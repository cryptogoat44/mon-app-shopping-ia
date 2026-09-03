-- ============================================================
-- Bloc 4 — bucket de stockage pour les photos du vault (achats).
-- Public (contrairement à "screenshots") : ce sont des photos que
-- l'utilisateur choisit de montrer dans l'app (à son cercle ou au
-- public selon le réglage de confidentialité de l'item). L'accès
-- passe toujours par notre backend, qui ne renvoie l'URL que si
-- l'utilisateur a le droit de voir l'item — le bucket public sert
-- juste à ce que l'app puisse afficher l'image directement, sans
-- transiter par notre serveur à chaque affichage.
-- ============================================================
insert into storage.buckets (id, name, public)
values ('vault-media', 'vault-media', true)
on conflict (id) do nothing;
