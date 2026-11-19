-- 0045 (lot « vie sociale », 2026-11-18) : compte privé et demandes
-- d'abonnement. Un membre peut rendre son compte privé : seuls les abonnés
-- qu'il a acceptés voient ses publications ; les autres envoient une demande.
--
-- Retour en arrière (après avoir remis un serveur qui ne connaît pas 0045 ;
-- les demandes en attente sont alors perdues, et tous les comptes
-- redeviennent publics : à ne faire qu'en connaissance de cause). Les
-- notifications des nouveaux types sont effacées d'abord, sinon l'ancienne
-- règle refuserait de revenir :
--   delete from notifications where type in ('follow_request', 'follow_accepted', 'reply', 'mention', 'tag');
--   alter table notifications drop constraint if exists notifications_type_check;
--   alter table notifications add constraint notifications_type_check
--     check (type in ('follow', 'like', 'comment', 'moderation', 'report_handled', 'piece_received'));
--   drop table if exists follow_requests;
--   alter table profiles drop column if exists is_private;
--
-- Ce qu'elle ajoute :
-- 1. profiles.is_private : faux par défaut (compte public, comme avant).
--    Aucun compte existant ne change.
-- 2. follow_requests : une demande d'abonnement en attente (qui demande, à
--    qui, quand). Une seule par paire de comptes ; jamais à soi-même.
--    Supprimée quand elle est acceptée, refusée ou annulée, et avec l'un ou
--    l'autre des deux comptes. Un refus ne laisse aucune trace.
-- 3. notifications : cinq types de plus, ajoutés une seule fois pour tout le
--    lot « vie sociale » : 'follow_request' et 'follow_accepted' (cette
--    migration), 'reply', 'mention' et 'tag' (0046 et 0047, qui n'auront plus
--    à toucher cette règle). Chacun a un auteur : la règle
--    notifications_actor_check ne change pas.
--
-- Facultative pour le serveur : sans elle, tous les comptes sont traités
-- comme publics, le réglage « Compte privé » est caché dans l'app et les
-- routes des demandes répondent « indisponible » (sonde du schéma,
-- lib/audience.ts). À appliquer APRÈS 0024 (vérifié ci-dessous), d'abord sur
-- spotto-dev-2 (migrer-dev), puis sur spotto-prod. Rejouable sans effet (if
-- not exists, drop constraint if exists) ; ne supprime ni ne modifie aucune
-- donnée existante.
-- Aucune règle d'accès public : seul le serveur, avec sa clé secrète, lit et
-- écrit cette table (RLS active, aucune politique). Aucun déclencheur.

do $$
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'notifications' and column_name = 'piece_send_id') then
    raise exception '0045 demande la migration 0024 (partage des envies) : appliquez-la d''abord, puis relancez 0045.';
  end if;
end;
$$;

-- ---- Compte privé ----
alter table profiles add column if not exists is_private boolean not null default false;

-- ---- Demandes d'abonnement en attente ----
create table if not exists follow_requests (
  requester_id uuid not null references profiles(id) on delete cascade,
  target_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (requester_id, target_id),
  check (requester_id <> target_id)
);
-- Demandes reçues par un compte, les plus récentes d'abord.
create index if not exists follow_requests_target_idx on follow_requests (target_id, created_at desc);
alter table follow_requests enable row level security;

-- Le serveur seul : ni les visiteurs, ni les comptes connectés.
revoke all on table follow_requests from public, anon, authenticated;
grant select, insert, update, delete on table follow_requests to service_role;

-- ---- Notifications : les types du lot « vie sociale » ----
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('follow', 'like', 'comment', 'moderation', 'report_handled', 'piece_received',
                  'follow_request', 'follow_accepted', 'reply', 'mention', 'tag'));

notify pgrst, 'reload schema';
