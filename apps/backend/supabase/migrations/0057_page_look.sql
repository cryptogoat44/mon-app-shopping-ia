-- 0057 (lot « page look », décisions du fondateur du 23 novembre 2026).
--
-- « Partager le look » crée un lien vers une page en lecture seule, visible
-- sans compte : la pièce partagée, les boutiques et les prix vus le jour de
-- la recherche, puis « Trouver la mienne ». Cette table garde chaque page,
-- construite par le serveur au moment du partage (liste fixe de champs), et
-- rien d'autre : ni le nom du membre, ni sa photo, ni le lien de la vidéo, ni
-- ses mots. La page publique est servie par une route du serveur
-- (GET /api/looks/public/:token, clé secrète du serveur) : AUCUNE fonction ni
-- table n'est ouverte à la clé publique (RLS active, aucune politique).
--
-- Retour en arrière (après avoir remis un serveur qui ne connaît pas 0057 ;
-- toutes les pages disparaissent ; les copies d'images du dossier
-- post-media/looks/ restent dans le stockage : les effacer à la main, dans
-- Storage de Supabase) :
--   drop table if exists shared_looks;
--
-- Arrêt d'urgence de toutes les pages, sans rien perdre (le serveur ne peut
-- plus lire la table : chaque page répond « La page n'a pas pu être
-- chargée », plus aucune création, liste ni export tant que dure l'arrêt ;
-- si le serveur redémarre pendant l'arrêt, il croit 0057 absente : chaque
-- page répond « Cette page n'est plus disponible », le bouton redevient
-- « Partager » et « Pages look partagées » est caché ; la suppression d'un
-- compte marche toujours, mais les copies d'images de ses pages restent dans
-- post-media/looks/ : les effacer à la main, dans Storage de Supabase) :
--   revoke select on table shared_looks from service_role;
-- Reprise :
--   grant select on table shared_looks to service_role;
--
-- Ce qu'elle ajoute :
-- shared_looks : une ligne par page partagée.
--   id : identifiant interne (routes du membre), jamais public ;
--   user_id : le membre qui partage ; la page part avec son compte ;
--   search_id : la recherche d'origine ; la page part avec elle (purge des 12 mois) ;
--   match_id : la pièce partagée (une page au plus par membre et par pièce), jamais affichée ;
--   token : le seul identifiant public, 16 octets aléatoires (22 signes), impossible à deviner ;
--   content : la page (nom de la pièce, marque, verdict, boutiques, prix,
--     mentions, stock, jour de la recherche), 16 Ko au plus ;
--   image_path : la copie de l'image faite par le serveur (480 px), sous un
--     nom aléatoire sans rien du membre (post-media/looks/<uuid>.jpg : jamais
--     son dossier, dont l'adresse dévoilerait l'identifiant de son compte), ou
--     vide ; le serveur l'efface à l'arrêt, à l'expiration, avec la recherche
--     et avec le compte ;
--   created_at, expires_at : 30 jours au plus (31 tolérés par la règle).
--
-- Facultative pour le serveur : sans elle, aucune page n'est créée, le
-- bouton reste « Partager » comme aujourd'hui (sonde du schéma,
-- lib/lookPages.ts), et la création demande en plus LOOK_PAGES_ENABLED.
-- À appliquer APRÈS 0001 et 0023 (vérifié ci-dessous). D'abord sur
-- spotto-dev-2 (migrer-dev), puis sur spotto-prod. Rejouable sans effet
-- (if not exists) ; ne supprime ni ne modifie aucune donnée existante.

do $$
begin
  if to_regclass('public.profiles') is null or to_regclass('public.product_searches') is null or to_regclass('public.product_matches') is null then
    raise exception '0057 demande la migration 0001 (profils, recherches et propositions) : appliquez d''abord les migrations précédentes.';
  end if;
  if to_regclass('public.suspensions') is null then
    raise exception '0057 demande la migration 0023 (comptes suspendus) : appliquez d''abord les migrations précédentes.';
  end if;
end;
$$;

create table if not exists shared_looks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  search_id uuid not null references product_searches(id) on delete cascade,
  match_id uuid not null references product_matches(id) on delete cascade,
  token text not null unique check (token ~ '^[A-Za-z0-9_-]{22}$'),
  content jsonb not null check (jsonb_typeof(content) = 'object' and pg_column_size(content) <= 16384),
  image_path text check (image_path is null or image_path ~ '^looks/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  constraint shared_looks_expiry check (expires_at > created_at and expires_at <= created_at + interval '31 days')
);

create unique index if not exists shared_looks_user_match on shared_looks (user_id, match_id);
create index if not exists shared_looks_user_created on shared_looks (user_id, created_at desc);
create index if not exists shared_looks_expires on shared_looks (expires_at);

alter table shared_looks enable row level security;
revoke all on table shared_looks from public, anon, authenticated;
grant select, insert, update, delete on table shared_looks to service_role;

notify pgrst, 'reload schema';
