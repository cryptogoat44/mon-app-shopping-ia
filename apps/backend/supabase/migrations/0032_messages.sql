-- 0032 (lot « messages privés », 2026-11-08) : messages entre membres, pour
-- partager et discuter de ses envies.
--
-- Retour en arrière (après avoir remis un serveur qui ne connaît pas 0032 ;
-- les messages et les conversations sont alors perdus ; une suspension
-- décidée depuis un message signalé reste en place) :
--   update moderation_actions set target_type = 'user', target_id = target_user_id
--     where target_type = 'message' and action in ('suspend', 'unsuspend');
--   delete from notifications n using moderation_actions m
--     where n.moderation_action_id = m.id and m.target_type = 'message';
--   delete from reports where target_type = 'message';
--   delete from moderation_actions where target_type = 'message';
--   drop table if exists messages, conversation_participants, conversations cascade;
--   drop function if exists messages_after_insert();
--   alter table profiles drop column if exists messages_from;
--   alter table reports drop constraint if exists reports_target_type_check;
--   alter table reports add constraint reports_target_type_check
--     check (target_type in ('user', 'post', 'comment', 'piece'));
--   alter table moderation_actions drop constraint if exists moderation_actions_target_type_check;
--   alter table moderation_actions add constraint moderation_actions_target_type_check
--     check (target_type in ('user', 'post', 'comment', 'piece'));
-- puis relancer le fichier 0030_masquage_automatique.sql en entier (il remet
-- moderation_apply sans les messages). moderation_set_hidden garde une
-- branche « message » qui ne sert plus jamais (sans effet).
--
-- Ce qu'elle ajoute :
-- 1. conversations : une seule conversation par paire de membres
--    (user_low < user_high). Supprimée avec le compte de l'un OU de l'autre,
--    avec tous ses messages (choix du lot : une conversation dont un membre
--    est parti disparaît pour les deux, comme une pièce envoyée).
-- 2. conversation_participants : le côté de chaque membre — état de
--    l'invitation, lecture, messages effacés de sa vue après un refus.
--    invitation : 'none' (conversation ouverte), 'sent' (j'ai invité, en
--    attente), 'received' (on m'a invité, section « Invitations »),
--    'declined' (j'ai refusé : conversation cachée pour moi ; invitation_at
--    date le refus, qui empêche une nouvelle invitation pendant 30 jours).
-- 3. messages : un texte (1 000 caractères au plus) et/ou une envie jointe
--    (instantané : titre, copie de l'image dans notre stockage, prix, lien
--    marchand). hidden_at : masqué par la modération.
-- 4. profiles.messages_from : « Qui peut m'écrire » (invitations des membres
--    qui ne sont pas des amis) : 'everyone' par défaut, 'following' (les
--    comptes que je suis) ou 'nobody' (seulement mes amis).
-- 5. Signalement et modération d'un message : le type 'message' dans
--    reports et moderation_actions ; moderation_set_hidden et
--    moderation_apply (reprises de 0024 et 0030) savent masquer un message.
--
-- Facultative pour le serveur : sans elle, les routes des messages répondent
-- « indisponible » et l'app cache l'entrée Messages (sonde du schéma,
-- lib/messaging.ts). À appliquer APRÈS 0030 (vérifié ci-dessous), d'abord sur
-- spotto-dev-2 (migrer-dev), puis sur spotto-prod. Ne relancez pas 0030 après
-- 0032 (elle remettrait moderation_apply sans les messages) ; si c'est fait,
-- relancez 0032. Rejouable sans effet (if not exists, create or replace) ;
-- ne supprime ni ne modifie aucune donnée existante.
-- Aucune règle d'accès public : seul le serveur, avec sa clé secrète, lit et
-- écrit ces tables (RLS active, aucune politique).

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'moderation_auto_hide') then
    raise exception 'Appliquez d''abord la migration 0030 (masquage automatique), puis relancez 0032.';
  end if;
end;
$$;

-- ---- Conversations ----
create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  user_low uuid not null references profiles(id) on delete cascade,
  user_high uuid not null references profiles(id) on delete cascade,
  -- Dernier message (aperçu de la liste), tenu à jour par la base.
  last_message_id uuid,
  last_sender_id uuid,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (user_low < user_high),
  unique (user_low, user_high)
);
create index if not exists conversations_user_high_idx on conversations (user_high);
alter table conversations enable row level security;

-- ---- Le côté de chaque membre ----
create table if not exists conversation_participants (
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  other_user_id uuid not null references profiles(id) on delete cascade,
  invitation text not null default 'none' check (invitation in ('none', 'sent', 'received', 'declined')),
  invitation_at timestamptz,
  -- Un message reçu et pas encore lu (tenu à jour par la base à chaque message).
  unread boolean not null default false,
  last_read_at timestamptz,
  -- Messages antérieurs cachés pour ce membre (refus d'une invitation).
  cleared_at timestamptz,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (conversation_id, user_id),
  check (user_id <> other_user_id)
);
create index if not exists conversation_participants_user_idx on conversation_participants (user_id, last_message_at desc);
create index if not exists conversation_participants_other_idx on conversation_participants (other_user_id);
alter table conversation_participants enable row level security;

-- ---- Messages ----
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references profiles(id) on delete cascade,
  body text check (body is null or char_length(btrim(body)) between 1 and 1000),
  -- Envie jointe : instantané au moment de l'envoi, image copiée dans notre
  -- stockage (post-media/<expéditeur>/…), jamais l'adresse du marchand.
  wish_title text check (wish_title is null or char_length(btrim(wish_title)) between 1 and 120),
  wish_image_url text,
  wish_image_thumb_url text,
  wish_merchant_name text check (wish_merchant_name is null or char_length(wish_merchant_name) <= 120),
  wish_merchant_url text check (wish_merchant_url is null or char_length(wish_merchant_url) <= 2048),
  wish_product_match_id uuid references product_matches(id) on delete set null,
  wish_price_min numeric(10,2),
  wish_currency char(3),
  hidden_at timestamptz,
  created_at timestamptz not null default now(),
  check (body is not null or wish_title is not null),
  check (wish_title is null or (wish_image_url is not null and wish_image_thumb_url is not null))
);
create index if not exists messages_conversation_idx on messages (conversation_id, created_at desc);
create index if not exists messages_sender_idx on messages (sender_id);
create index if not exists messages_wish_product_match_id_idx on messages (wish_product_match_id);
alter table messages enable row level security;

alter table conversations drop constraint if exists conversations_last_message_id_fkey;
alter table conversations add constraint conversations_last_message_id_fkey
  foreign key (last_message_id) references messages(id) on delete set null;
create index if not exists conversations_last_message_id_idx on conversations (last_message_id);

-- Chaque nouveau message : aperçu de la conversation, ordre de la liste et
-- « non lu » de l'autre membre, dans la même transaction que l'envoi.
create or replace function messages_after_insert()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  update conversations
    set last_message_id = new.id, last_sender_id = new.sender_id, last_message_at = new.created_at
    where id = new.conversation_id and last_message_at <= new.created_at;
  update conversation_participants
    set last_message_at = greatest(last_message_at, new.created_at),
        unread = case when user_id <> new.sender_id then true else unread end
    where conversation_id = new.conversation_id;
  return new;
end;
$$;
drop trigger if exists messages_after_insert on messages;
create trigger messages_after_insert after insert on messages
  for each row execute function messages_after_insert();
revoke all on function messages_after_insert() from public, anon, authenticated;

revoke all on table conversations, conversation_participants, messages from public, anon, authenticated;
grant select, insert, update, delete on table conversations, conversation_participants, messages to service_role;

-- ---- Réglage « Qui peut m'écrire » ----
alter table profiles add column if not exists messages_from text not null default 'everyone';
alter table profiles drop constraint if exists profiles_messages_from_check;
alter table profiles add constraint profiles_messages_from_check
  check (messages_from in ('following', 'everyone', 'nobody'));

-- ---- Signalement et modération d'un message ----
alter table reports drop constraint if exists reports_target_type_check;
alter table reports add constraint reports_target_type_check
  check (target_type in ('user', 'post', 'comment', 'piece', 'message'));
alter table moderation_actions drop constraint if exists moderation_actions_target_type_check;
alter table moderation_actions add constraint moderation_actions_target_type_check
  check (target_type in ('user', 'post', 'comment', 'piece', 'message'));

-- Masquer (p_at = maintenant) ou rétablir (p_at = null) un contenu. Reprend
-- la version de la migration 0024 et ajoute le message.
create or replace function moderation_set_hidden(p_target_type text, p_target_id uuid, p_at timestamptz)
returns void
language plpgsql
set search_path = public
as $$
begin
  if p_target_type = 'post' then
    update posts set hidden_at = p_at where id = p_target_id;
    update notifications n set hidden_at = p_at
      where n.post_id = p_target_id and n.type in ('like', 'comment')
        and (p_at is not null or n.comment_id is null
             or not exists (select 1 from comments c where c.id = n.comment_id and c.hidden_at is not null));
  elsif p_target_type = 'comment' then
    update comments set hidden_at = p_at where id = p_target_id;
    update notifications n set hidden_at = p_at
      where n.comment_id = p_target_id
        and (p_at is not null
             or not exists (select 1 from comments c join posts p on p.id = c.post_id where c.id = p_target_id and p.hidden_at is not null));
  elsif p_target_type = 'piece' then
    update piece_sends set hidden_at = p_at where id = p_target_id;
    update notifications n set hidden_at = p_at where n.piece_send_id = p_target_id;
  elsif p_target_type = 'message' then
    update messages set hidden_at = p_at where id = p_target_id;
  end if;
end;
$$;

-- Une décision d'administrateur, en une seule transaction. Reprend la
-- version de la migration 0030 ; seul ajout : le message (personne
-- concernée : celle qui l'a envoyé).
create or replace function moderation_apply(
  p_admin_id uuid,
  p_action text,
  p_target_type text,
  p_target_id uuid,
  p_reason text,
  p_note text
)
returns table (outcome text, action_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_user uuid;
  v_action uuid;
  v_open boolean;
  v_hidden boolean;
  v_auto uuid;
  v_restore uuid;
begin
  perform pg_advisory_xact_lock(hashtext('spotto_moderation'));
  if not exists (select 1 from admins a where a.user_id = p_admin_id) then
    return query select 'not_admin'::text, null::uuid;
    return;
  end if;
  if p_action is null or p_action not in ('dismiss', 'hide', 'suspend')
     or p_target_type is null or p_target_type not in ('user', 'post', 'comment', 'piece', 'message')
     or (p_action = 'hide' and p_target_type = 'user')
     or (p_action in ('hide', 'suspend') and p_reason is null) then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  v_user := case p_target_type
    when 'post' then (select p.user_id from posts p where p.id = p_target_id)
    when 'comment' then (select c.user_id from comments c where c.id = p_target_id)
    when 'piece' then (select s.sender_id from piece_sends s where s.id = p_target_id)
    when 'message' then (select m.sender_id from messages m where m.id = p_target_id)
    else (select pr.id from profiles pr where pr.id = p_target_id)
  end;
  v_open := exists (select 1 from reports r where r.target_type = p_target_type and r.target_id = p_target_id and r.handled_at is null);
  if v_user is null and (p_action <> 'dismiss' or not v_open) then
    return query select 'target_not_found'::text, null::uuid;
    return;
  end if;
  if p_action = 'dismiss' and not v_open then
    return query select 'already_handled'::text, null::uuid;
    return;
  end if;

  v_hidden := case p_target_type
    when 'post' then exists (select 1 from posts p where p.id = p_target_id and p.hidden_at is not null)
    when 'comment' then exists (select 1 from comments c where c.id = p_target_id and c.hidden_at is not null)
    when 'piece' then exists (select 1 from piece_sends s where s.id = p_target_id and s.hidden_at is not null)
    when 'message' then exists (select 1 from messages m where m.id = p_target_id and m.hidden_at is not null)
    else false
  end;
  -- Masquage automatique encore en vigueur (jamais annulé ni confirmé).
  if v_hidden then
    select m.id into v_auto
      from moderation_actions m
      where m.target_type = p_target_type and m.target_id = p_target_id and m.action = 'hide' and m.automatic
        and not exists (select 1 from moderation_actions u where u.undoes_action_id = m.id)
      order by m.created_at desc
      limit 1;
  end if;

  if p_action = 'hide' and v_hidden and v_auto is null then
    return query select 'already_hidden'::text, null::uuid;
    return;
  end if;
  if p_action = 'suspend' and exists (select 1 from suspensions s where s.user_id = v_user) then
    return query select 'already_suspended'::text, null::uuid;
    return;
  end if;

  -- Confirmer un masquage automatique : la décision de l'administrateur le
  -- remplace (undoes_action_id), le contenu reste masqué.
  insert into moderation_actions (admin_id, action, target_type, target_id, target_user_id, reason, note, undoes_action_id)
    values (p_admin_id, p_action, p_target_type, p_target_id, v_user, p_reason, nullif(btrim(p_note), ''),
            case when p_action = 'hide' then v_auto end)
    returning id into v_action;

  if p_action = 'hide' then
    perform moderation_set_hidden(p_target_type, p_target_id, now());
  elsif p_action = 'suspend' then
    insert into suspensions (user_id, moderation_action_id) values (v_user, v_action);
  elsif p_action = 'dismiss' and v_auto is not null then
    -- Classé sans suite : le masquage automatique est levé, la personne
    -- concernée apprend que son contenu est rétabli.
    insert into moderation_actions (admin_id, action, target_type, target_id, target_user_id, undoes_action_id)
      values (p_admin_id, 'restore', p_target_type, p_target_id, v_user, v_auto)
      returning id into v_restore;
    perform moderation_set_hidden(p_target_type, p_target_id, null);
    insert into notifications (user_id, actor_id, type, moderation_action_id) values (v_user, null, 'moderation', v_restore);
  end if;

  -- La personne concernée est prévenue, sauf d'un classement sans suite, et
  -- sauf d'une confirmation : elle a déjà appris le masquage automatique.
  if p_action <> 'dismiss' and not (p_action = 'hide' and v_auto is not null) then
    insert into notifications (user_id, actor_id, type, moderation_action_id) values (v_user, null, 'moderation', v_action);
  end if;

  with handled as (
    update reports r set handled_at = now(), moderation_action_id = v_action
    where r.target_type = p_target_type and r.target_id = p_target_id and r.handled_at is null
    returning r.reporter_id
  )
  insert into notifications (user_id, actor_id, type, moderation_action_id)
    select distinct h.reporter_id, null::uuid, 'report_handled', v_action from handled h;

  return query select 'ok'::text, v_action;
end;
$$;

-- Le serveur seul : ni les visiteurs, ni les comptes connectés.
revoke all on function moderation_set_hidden(text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function moderation_set_hidden(text, uuid, timestamptz) to service_role;
revoke all on function moderation_apply(uuid, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function moderation_apply(uuid, text, text, uuid, text, text) to service_role;

notify pgrst, 'reload schema';
