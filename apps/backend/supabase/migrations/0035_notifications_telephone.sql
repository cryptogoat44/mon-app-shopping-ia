-- 0035 (lot « notifications sur le téléphone », 2026-11-09) : les appareils
-- prévenus des nouveaux messages privés.
--
-- Retour en arrière (après avoir remis un serveur qui ne connaît pas 0035,
-- ou simplement coupé PUSH_ENABLED ; les appareils enregistrés sont alors
-- oubliés, rien d'autre ne change) :
--   drop table if exists push_tokens;
--
-- Ce qu'elle ajoute :
-- push_tokens : un appareil qui reçoit les notifications des nouveaux
-- messages. Le jeton donné par Expo (« ExponentPushToken[…] »), unique : un
-- téléphone n'est qu'à un seul compte à la fois. Le système (iPhone ou
-- Android), les dates d'enregistrement et de mise à jour, et le code de la
-- dernière erreur renvoyée par Expo (par exemple « MessageRateExceeded »),
-- jamais un texte. Supprimé avec le compte (cascade), quand la personne
-- coupe les notifications ou se déconnecte, et quand Expo dit que
-- l'appareil n'est plus inscrit.
--
-- Facultative pour le serveur : sans elle, rien n'est enregistré ni envoyé,
-- et l'app ne propose pas les notifications (sonde du schéma, lib/push.ts).
-- Les notifications restent aussi coupées tant que PUSH_ENABLED ne vaut pas
-- « true » chez Render. À appliquer d'abord sur spotto-dev-2 (migrer-dev),
-- puis sur spotto-prod. Rejouable sans effet (if not exists) ; ne supprime
-- ni ne modifie aucune donnée existante.
-- Aucune règle d'accès public : seul le serveur, avec sa clé secrète, lit et
-- écrit cette table (RLS active, aucune politique).

create table if not exists push_tokens (
  token text primary key check (char_length(token) between 10 and 200),
  user_id uuid not null references profiles(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_error text check (last_error is null or char_length(last_error) <= 60)
);
-- Les appareils d'un membre (envoi d'une notification, export, suppression).
create index if not exists push_tokens_user_idx on push_tokens (user_id, updated_at desc);
alter table push_tokens enable row level security;

-- Le serveur seul : ni les visiteurs, ni les comptes connectés.
revoke all on table push_tokens from public, anon, authenticated;
grant select, insert, update, delete on table push_tokens to service_role;

notify pgrst, 'reload schema';
