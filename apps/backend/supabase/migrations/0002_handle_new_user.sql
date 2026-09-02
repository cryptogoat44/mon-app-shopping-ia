-- ============================================================
-- À l'inscription d'un utilisateur (auth.users), on crée
-- automatiquement sa ligne `profiles`, avec username = null.
-- L'app mobile affichera l'écran "complète ton profil" tant que
-- username est vide (cf. isProfileComplete côté shared-types).
-- ============================================================

create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
