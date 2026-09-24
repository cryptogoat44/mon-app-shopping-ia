-- Lot « images et fluidité » : miniature (480 px) des photos publiées, pour
-- les grilles du profil. Nulle pour les publications « achat » (elles
-- montrent l'image de la pièce) et pour les photos publiées avant ce lot.
alter table posts add column if not exists media_thumb_url text;
