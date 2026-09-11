-- Permet de créer une recherche à partir d'une photo importée seule, sans
-- lien vidéo source (le flux "Importer une photo" de l'écran Spotter).
-- source_url devient optionnel ; 'photo' rejoint platform_source pour ces
-- recherches (method reste 'manual_screenshot', déjà existant).

alter table product_searches alter column source_url drop not null;
alter type platform_source add value 'photo';
