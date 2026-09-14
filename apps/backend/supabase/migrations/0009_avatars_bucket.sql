-- Bucket de stockage pour les photos de profil. Public comme vault-media/
-- post-media : la photo de profil n'est jamais soumise à la confidentialité
-- d'un objet particulier, elle est visible partout où le profil l'est.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;
