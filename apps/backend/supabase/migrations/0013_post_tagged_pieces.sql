-- Étape 1.E : pièces taguées dans les publications. Chaque ligne référence
-- exactement une source — soit un objet du Vault de l'auteur, soit un
-- product_match issu d'une de ses recherches — jamais les deux, jamais
-- aucun (contrainte ci-dessous). La confidentialité de la pièce taguée
-- dans le Vault n'a aucun effet ici (elle n'est ni lue ni modifiée par le
-- backend) : l'avertissement avant publication est une responsabilité
-- mobile. Voir docs/journal-decisions.md, 2026-09-23.
create table post_tagged_pieces (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  vault_item_id uuid references vault_items(id) on delete cascade,
  product_match_id uuid references product_matches(id) on delete cascade,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  constraint post_tagged_pieces_one_source check (
    (vault_item_id is not null) <> (product_match_id is not null)
  )
);

create index post_tagged_pieces_post_id_idx on post_tagged_pieces (post_id);

alter table post_tagged_pieces enable row level security;
