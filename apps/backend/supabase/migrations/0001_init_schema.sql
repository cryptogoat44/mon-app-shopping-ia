-- ============================================================
-- Schéma initial — Phase 1 complète (validé le 2026-09-02)
-- À exécuter une seule fois, en entier, dans Supabase > SQL Editor.
-- ============================================================

create extension if not exists pgcrypto;

-- ---- Types énumérés ----
create type platform_source as enum ('tiktok', 'instagram', 'other');
create type recognition_method as enum ('oembed', 'manual_screenshot');
create type search_status as enum ('pending', 'processing', 'completed', 'failed');
create type privacy_level as enum ('public', 'followers', 'private');
create type post_type as enum ('lifestyle', 'purchase');
create type media_kind as enum ('photo', 'video');
create type affiliate_network as enum ('awin', 'rakuten', 'cj', 'partnerize', 'direct', 'other');
create type conversion_status as enum ('pending', 'confirmed', 'rejected');
create type vault_category as enum ('clothing', 'watches', 'accessories', 'shoes', 'bags', 'home', 'other');
create type consent_type as enum ('terms', 'privacy_policy', 'marketing_email');
create type export_status as enum ('requested', 'processing', 'ready', 'failed');

-- ---- PROFILES — étend auth.users fourni par Supabase Auth ----
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  display_name text not null,
  avatar_url text,
  bio text,
  locale text not null default 'fr',
  default_privacy privacy_level not null default 'followers',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint username_format check (username is null or username ~ '^[a-z0-9_]{3,20}$')
);

-- ---- FOLLOWS — relation d'abonnement ----
create table follows (
  follower_id uuid not null references profiles(id) on delete cascade,
  followee_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  check (follower_id <> followee_id)
);
create index on follows (followee_id);

-- ---- PRODUCT_SEARCHES — une recherche = un lien collé par l'utilisateur ----
create table product_searches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  source_url text not null,
  source_platform platform_source not null,
  method recognition_method not null,
  thumbnail_url text,
  screenshot_url text,
  status search_status not null default 'pending',
  error_message text,
  created_at timestamptz not null default now()
);
create index on product_searches (user_id, created_at desc);

-- ---- PRODUCT_MATCHES — résultats renvoyés par l'API de recherche visuelle ----
create table product_matches (
  id uuid primary key default gen_random_uuid(),
  search_id uuid not null references product_searches(id) on delete cascade,
  rank smallint not null,
  product_name text not null,
  brand text,
  image_url text not null,
  price_min numeric(10,2),
  price_max numeric(10,2),
  currency char(3) default 'EUR',
  confidence_score numeric(4,3),
  merchant_name text,
  merchant_url text not null,
  created_at timestamptz not null default now(),
  unique (search_id, rank)
);

-- ---- AFFILIATE_LINKS — notre wrapper trackable autour du lien marchand ----
create table affiliate_links (
  id uuid primary key default gen_random_uuid(),
  product_match_id uuid not null references product_matches(id) on delete cascade,
  network affiliate_network not null,
  affiliate_url text not null,
  created_at timestamptz not null default now()
);

-- ---- AFFILIATE_CLICKS — un clic sortant vers un marchand ----
create table affiliate_clicks (
  id uuid primary key default gen_random_uuid(),
  affiliate_link_id uuid not null references affiliate_links(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  clicked_at timestamptz not null default now(),
  ip_hash text,
  user_agent text
);
create index on affiliate_clicks (user_id, clicked_at desc);

-- ---- AFFILIATE_CONVERSIONS — alimentée par le webhook du réseau d'affiliation ----
create table affiliate_conversions (
  id uuid primary key default gen_random_uuid(),
  affiliate_click_id uuid references affiliate_clicks(id) on delete set null,
  external_conversion_id text not null unique,
  amount numeric(10,2) not null,
  currency char(3) not null default 'EUR',
  commission numeric(10,2),
  status conversion_status not null default 'pending',
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---- VAULT_ITEMS — galerie personnelle des achats ----
create table vault_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  product_match_id uuid references product_matches(id) on delete set null,
  affiliate_conversion_id uuid references affiliate_conversions(id) on delete set null,
  title text not null,
  image_url text not null,
  category vault_category not null default 'other',
  verified boolean not null default false,
  privacy privacy_level not null default 'followers',
  created_at timestamptz not null default now()
);
create index on vault_items (user_id, created_at desc);

-- ---- POSTS — contenu publié sur le profil ----
create table posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type post_type not null,
  vault_item_id uuid references vault_items(id) on delete set null,
  caption text,
  media_kind media_kind not null,
  media_url text,
  mux_playback_id text,
  privacy privacy_level not null default 'followers',
  created_at timestamptz not null default now(),
  check (type = 'lifestyle' or vault_item_id is not null)
);
create index on posts (user_id, created_at desc);

-- ---- POST_REACTIONS — réaction simple ----
create table post_reactions (
  post_id uuid not null references posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- ---- CONSENTS — traçabilité RGPD des consentements ----
create table consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type consent_type not null,
  granted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

-- ---- DATA_EXPORT_REQUESTS — demandes d'export RGPD ----
create table data_export_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  status export_status not null default 'requested',
  file_url text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

-- ============================================================
-- Sécurité par défaut : on verrouille TOUTES les tables dès
-- maintenant (RLS activé, aucune règle = personne ne peut lire/
-- écrire via l'API publique Supabase). Chaque bloc ajoutera ses
-- propres règles d'accès au moment où il expose la table
-- concernée. Le backend, lui, continue d'y accéder normalement
-- via la clé service_role qui contourne RLS.
-- ============================================================
alter table profiles enable row level security;
alter table follows enable row level security;
alter table product_searches enable row level security;
alter table product_matches enable row level security;
alter table affiliate_links enable row level security;
alter table affiliate_clicks enable row level security;
alter table affiliate_conversions enable row level security;
alter table vault_items enable row level security;
alter table posts enable row level security;
alter table post_reactions enable row level security;
alter table consents enable row level security;
alter table data_export_requests enable row level security;
