-- Lot Q, bloc 1 (audit DON-01) : retirer du Vault un objet déjà partagé en
-- publication "achat" échouait toujours. La clé étrangère posts.vault_item_id
-- était en "on delete set null", mais la contrainte
-- check (type = 'lifestyle' or vault_item_id is not null) interdit justement
-- à une publication "achat" de ne pointer vers rien : les deux règles se
-- contredisaient et Postgres refusait la suppression.
--
-- Décision du fondateur (docs/journal-decisions.md, 2026-09-23, décision 1) :
-- retirer l'objet supprime aussi la publication "achat" qui le montre. Le
-- passage en "on delete cascade" rend la suppression atomique (tout ou rien,
-- en une seule instruction) ; les cascades déjà en place sur posts nettoient
-- ensuite pièces taguées, j'aime et notifications de ces publications.
-- Les publications "lifestyle" ne sont pas concernées (vault_item_id y est
-- toujours null) ; un objet seulement tagué sur une photo lifestyle perd
-- son tag (cascade déjà en place sur post_tagged_pieces), pas la photo.
alter table posts drop constraint posts_vault_item_id_fkey;

alter table posts
  add constraint posts_vault_item_id_fkey
  foreign key (vault_item_id) references vault_items(id) on delete cascade;
