-- 0044 (lot « messages, plus de confort », 2026-11-18) : dans une
-- conversation, aimer un message (❤️), répondre à un message précis,
-- supprimer un de ses messages, envoyer une publication du fil.
--
-- Retour en arrière (après avoir remis un serveur qui ne connaît pas 0044).
-- ATTENTION, il efface des messages pour de bon, à lancer dans cet ordre :
-- l'ancienne règle de la base refuse un message sans texte ni envie jointe,
-- et un message supprimé par son auteur redeviendrait visible si son contenu
-- avait été conservé pour la modération. Il faut donc d'abord effacer les
-- messages supprimés (leur contenu conservé pour la modération est alors
-- perdu) et les messages qui ne portent qu'une publication :
--   delete from messages where deleted_at is not null or (body is null and wish_title is null);
--   alter table messages drop constraint if exists messages_content_check;
--   alter table messages add check (body is not null or wish_title is not null);
--   drop table if exists message_reactions;
--   alter table messages drop column if exists reply_to_id;
--   alter table messages drop column if exists post_id;
--   alter table messages drop column if exists shared_post;
--   alter table messages drop column if exists deleted_at;
--   alter table messages drop column if exists updated_at;
-- Les « j'aime » des messages et les liens « réponse à » sont perdus ; un
-- message qui portait un texte ET une publication garde son texte seul.
--
-- Ce qu'elle ajoute :
-- 1. messages.reply_to_id : le message auquel celui-ci répond (même
--    conversation, vérifié par le serveur). Vidé si ce message disparaît.
-- 2. messages.post_id et messages.shared_post : une publication envoyée dans
--    un message. Rien de la publication n'est recopié dans le message (ni
--    légende, ni image, ni auteur) : le serveur la relit à chaque affichage,
--    pour la personne qui regarde, et ne la montre que si elle a le droit de
--    la voir à ce moment-là. shared_post reste vrai quand la publication est
--    supprimée (post_id est alors vidé) : la ligne reste valide, et l'app
--    affiche « Publication indisponible ».
-- 3. messages.deleted_at : le message a été supprimé par la personne qui
--    l'a écrit. Son texte et sa carte sont alors effacés de la base, SAUF
--    s'il avait été signalé avant : son contenu reste alors dans la base,
--    pour la modération seulement (le serveur ne le renvoie plus jamais aux
--    deux membres, qui voient « Message supprimé »).
-- 4. messages.updated_at : écrit par le serveur quand un message est aimé
--    ou supprimé, pour que l'app de l'autre membre l'apprenne à sa relecture
--    suivante. Vide pour un message jamais touché.
-- 5. message_reactions : un « j'aime » par membre et par message. Supprimés
--    avec le message, la conversation ou le compte.
-- 6. La règle « un message a un texte ou une envie jointe » (0032, sans nom)
--    est remplacée par messages_content_check : un texte, une envie jointe,
--    une publication envoyée, ou un message supprimé.
-- Aucun déclencheur : aimer ou supprimer un message ne change ni l'aperçu de
-- la conversation, ni son ordre, ni « non lu », et ne prévient personne.
--
-- Facultative pour le serveur : sans elle, la messagerie fonctionne comme
-- avant, et l'app ne propose ni « Aimer », ni « Répondre », ni « Supprimer »,
-- ni l'envoi d'une publication (sonde du schéma, lib/messaging.ts). À
-- appliquer APRÈS 0032 (vérifié ci-dessous) ; elle ne dépend pas de 0043
-- (confirmations de lecture) : l'une fonctionne sans l'autre. D'abord sur
-- spotto-dev-2 (migrer-dev), puis sur spotto-prod. Rejouable sans effet (if
-- not exists ; la règle est retirée puis remise) ; ne supprime ni ne modifie
-- aucune donnée existante.
-- Aucune règle d'accès public : seul le serveur, avec sa clé secrète, lit et
-- écrit ces tables (RLS active, aucune politique).

do $$
begin
  if to_regclass('public.messages') is null then
    raise exception '0044 demande la migration 0032 (messages) : appliquez-la d''abord.';
  end if;
end;
$$;

-- ---- Répondre, envoyer une publication, supprimer ----
alter table messages add column if not exists reply_to_id uuid references messages(id) on delete set null;
alter table messages add column if not exists post_id uuid references posts(id) on delete set null;
alter table messages add column if not exists shared_post boolean not null default false;
alter table messages add column if not exists deleted_at timestamptz;
alter table messages add column if not exists updated_at timestamptz;
create index if not exists messages_reply_to_idx on messages (reply_to_id) where reply_to_id is not null;
create index if not exists messages_post_idx on messages (post_id) where post_id is not null;
create index if not exists messages_changed_idx on messages (conversation_id, updated_at) where updated_at is not null;

-- ---- « J'aime » d'un message ----
create table if not exists message_reactions (
  message_id uuid not null references messages(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists message_reactions_user_idx on message_reactions (user_id);
alter table message_reactions enable row level security;

revoke all on table message_reactions from public, anon, authenticated;
grant select, insert, update, delete on table message_reactions to service_role;

-- ---- Ce qu'un message doit porter ----
-- La règle de 0032 n'a pas de nom : elle est retrouvée par sa définition
-- (texte ou envie jointe, rien d'autre), retirée, puis remplacée.
do $$
declare
  v_name text;
begin
  for v_name in
    select c.conname
      from pg_constraint c
      where c.conrelid = 'public.messages'::regclass and c.contype = 'c'
        and regexp_replace(lower(pg_get_constraintdef(c.oid)), '[\s()]', '', 'g') = 'checkbodyisnotnullorwish_titleisnotnull'
  loop
    execute format('alter table messages drop constraint %I', v_name);
  end loop;
end;
$$;
alter table messages drop constraint if exists messages_content_check;
alter table messages add constraint messages_content_check
  check (body is not null or wish_title is not null or shared_post or deleted_at is not null);

notify pgrst, 'reload schema';
