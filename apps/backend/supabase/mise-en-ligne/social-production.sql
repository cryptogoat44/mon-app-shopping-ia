-- Mise en production groupée (9 novembre 2026) : messagerie, collections
-- d'envies et leur modération. À coller EN ENTIER dans l'éditeur SQL de
-- Supabase, projet spotto-prod (adresse contenant selhqdqfrflsqivgxypf),
-- puis « Run ». Ensuite, coller social-verification.sql : 4 lignes, toutes
-- avec tout_est_bon = true.
--
-- AVANT : le serveur (spotto-api) et le site doivent déjà tourner sur un
-- main qui contient la migration 0034 (un serveur plus ancien ne connaît
-- pas les collections masquées). Vérifier dans /health la version donnée
-- par Claude.
--
-- Contenu, dans cet ordre (chaque fichier est recopié tel quel depuis
-- supabase/migrations/, sans aucun changement) :
--   0030 — masquage automatique après 3 signalements ;
--   0032 — messages privés entre membres (conversations, invitations) ;
--   0033 — collections d'envies, privées ou montrées aux amis ;
--   0034 — signaler et modérer les collections.
-- 0029 (compteurs de l'IA) n'en fait pas partie : elle reste facultative.
--
-- Rejouable : relancer ce fichier en entier ne change rien (chaque
-- migration l'est, et 0032 vient toujours après 0030). Ne relancez jamais
-- 0030 SEULE après coup : elle effacerait la prise en charge des messages et
-- des collections dans les fonctions de modération (il faudrait alors
-- relancer ce fichier en entier).
-- Retour en arrière : voir l'en-tête de chaque migration (ordre inverse).
-- Si Supabase affiche « destructive operation » : ces migrations contiennent
-- des « drop … if exists » de contraintes et de déclencheurs qu'elles
-- recréent aussitôt ; vous pouvez confirmer (« Run this query »).

-- ========================================================================
-- 0030_masquage_automatique.sql
-- ========================================================================

-- Chantier 3 de la feuille de route V1 (comptes et modération, point 6 ;
-- règle 1.2 d'Apple) : un contenu signalé par plusieurs personnes
-- DIFFÉRENTES est masqué aussitôt, en attendant la décision d'un
-- administrateur.
--
-- Facultative pour le serveur : sans elle, il enregistre les signalements
-- comme avant et ne masque rien automatiquement (lib/autoHide.ts détecte
-- l'absence de moderation_auto_hide). À appliquer à la main par le
-- fondateur, d'abord sur spotto-dev-2, puis sur spotto-prod.
-- Rejouable sans effet (if not exists, create or replace) ; ne supprime ni
-- ne modifie aucune donnée existante.
--
-- Ce qu'elle change :
-- 1. Le journal sait qu'une décision est automatique (colonne `automatic`).
-- 2. moderation_auto_hide : masque un contenu (publication, commentaire,
--    pièce envoyée) dès que N personnes différentes l'ont signalé (N fixé
--    par le serveur : 3), sans compter l'auteur ni les signalements déjà
--    traités ou antérieurs à un rétablissement. Ne comptent pas non plus :
--    un compte créé depuis moins d'un jour, un compte suspendu, une
--    personne dont un administrateur a déjà jugé un signalement de ce
--    contenu (voir la fonction). La personne concernée est prévenue ; les
--    signalements restent « à traiter ».
--    Pour essayer à la main : les comptes qui signalent doivent exister
--    depuis plus d'un jour.
-- 3. moderation_apply (reprise de la version de 0024) : sur un contenu
--    masqué automatiquement, « Masquer » CONFIRME le masquage (au lieu de
--    répondre « déjà masqué »), et « Classer sans suite » le RÉTABLIT
--    (décision « rétabli » au journal, personne concernée prévenue).
-- 4. Un index pour retrouver vite les signalements d'une personne (son fil
--    ne montre plus ce qu'elle a signalé).

alter table moderation_actions add column if not exists automatic boolean not null default false;

create index if not exists reports_reporter_id_target_type_idx on reports (reporter_id, target_type, created_at desc);

-- Masquage automatique, en une seule transaction. outcome : « ok », ou la
-- raison pour laquelle rien n'est masqué (invalid, target_not_found,
-- already_hidden, below_threshold).
create or replace function moderation_auto_hide(p_target_type text, p_target_id uuid, p_threshold integer)
returns table (outcome text, action_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_user uuid;
  v_hidden timestamptz;
  v_since timestamptz;
  v_reporters integer;
  v_reason text;
  v_action uuid;
begin
  perform pg_advisory_xact_lock(hashtext('spotto_moderation'));
  if p_target_type is null or p_target_type not in ('post', 'comment', 'piece') or coalesce(p_threshold, 0) < 2 then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  if p_target_type = 'post' then
    select p.user_id, p.hidden_at into v_user, v_hidden from posts p where p.id = p_target_id;
  elsif p_target_type = 'comment' then
    select c.user_id, c.hidden_at into v_user, v_hidden from comments c where c.id = p_target_id;
  else
    select s.sender_id, s.hidden_at into v_user, v_hidden from piece_sends s where s.id = p_target_id;
  end if;
  if v_user is null then
    return query select 'target_not_found'::text, null::uuid;
    return;
  end if;
  if v_hidden is not null then
    return query select 'already_hidden'::text, null::uuid;
    return;
  end if;

  -- Un contenu rétabli par un administrateur ne se remasque qu'avec de
  -- NOUVEAUX signalements, faits après ce rétablissement.
  select max(m.created_at) into v_since
    from moderation_actions m
    where m.target_type = p_target_type and m.target_id = p_target_id and m.action = 'restore';

  -- Signalements qui comptent, contre les masquages abusifs (relecture
  -- sécurité du chantier 3) :
  -- - pas ceux d'un compte créé depuis moins d'un jour au moment du
  --   signalement : trois comptes jetables, créés à la minute, ne font plus
  --   disparaître le contenu de quelqu'un ;
  -- - pas ceux d'un compte suspendu (il peut encore signaler, mais ne masque
  --   plus rien) ;
  -- - pas ceux d'une personne dont un administrateur a déjà traité un
  --   signalement de ce contenu, ou qui l'avait signalé avant son
  --   rétablissement : un contenu rétabli ou « classé sans suite » ne peut
  --   pas être remasqué aussitôt par les mêmes personnes (rien n'empêche de
  --   signaler deux fois). Il faut trois personnes nouvelles.
  with eligible as (
    select r.reporter_id, r.reason
      from reports r
      join profiles p on p.id = r.reporter_id
      where r.target_type = p_target_type and r.target_id = p_target_id
        and r.handled_at is null
        and r.reporter_id <> v_user
        and (v_since is null or r.created_at > v_since)
        and r.created_at >= p.created_at + interval '1 day'
        and not exists (select 1 from suspensions s where s.user_id = r.reporter_id)
        and not exists (
          select 1 from reports o
          where o.target_type = p_target_type and o.target_id = p_target_id and o.reporter_id = r.reporter_id
            and (o.handled_at is not null or (v_since is not null and o.created_at <= v_since))
        )
  )
  select
    (select count(distinct e.reporter_id)::integer from eligible e),
    -- Motif : le plus fréquent parmi ces signalements.
    (select e.reason from eligible e group by e.reason order by count(*) desc, e.reason limit 1)
    into v_reporters, v_reason;
  if v_reporters < p_threshold then
    return query select 'below_threshold'::text, null::uuid;
    return;
  end if;

  insert into moderation_actions (admin_id, action, target_type, target_id, target_user_id, reason, note, automatic)
    values (null, 'hide', p_target_type, p_target_id, v_user, v_reason, null, true)
    returning id into v_action;
  perform moderation_set_hidden(p_target_type, p_target_id, now());
  insert into notifications (user_id, actor_id, type, moderation_action_id) values (v_user, null, 'moderation', v_action);

  return query select 'ok'::text, v_action;
end;
$$;

-- Une décision d'administrateur, en une seule transaction. Reprend la
-- version de la migration 0024 ; seul ajout : le masquage automatique en
-- vigueur (v_auto), confirmé par « Masquer », levé par « Classer sans suite ».
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
     or p_target_type is null or p_target_type not in ('user', 'post', 'comment', 'piece')
     or (p_action = 'hide' and p_target_type = 'user')
     or (p_action in ('hide', 'suspend') and p_reason is null) then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  v_user := case p_target_type
    when 'post' then (select p.user_id from posts p where p.id = p_target_id)
    when 'comment' then (select c.user_id from comments c where c.id = p_target_id)
    when 'piece' then (select s.sender_id from piece_sends s where s.id = p_target_id)
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
revoke all on function moderation_auto_hide(text, uuid, integer) from public, anon, authenticated;
grant execute on function moderation_auto_hide(text, uuid, integer) to service_role;
revoke all on function moderation_apply(uuid, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function moderation_apply(uuid, text, text, uuid, text, text) to service_role;

notify pgrst, 'reload schema';

-- ========================================================================
-- 0032_messages.sql
-- ========================================================================

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

-- ========================================================================
-- 0033_collections.sql
-- ========================================================================

-- 0033 (lot « collections », 2026-11-09) : des collections d'envies, que le
-- membre peut choisir de montrer à ses amis.
--
-- Retour en arrière (après avoir remis un serveur qui ne connaît pas 0033 ;
-- les collections sont alors perdues, les envies restent) :
--   drop table if exists collection_image_copies, collection_items, collections cascade;
--   alter table wishlist_items drop constraint if exists wishlist_items_id_user_id_key;
-- Les copies d'images restées dans le stockage (post-media/<membre>/…) ne
-- gênent rien : elles partent avec le compte de leur propriétaire.
--
-- Ce qu'elle ajoute :
-- 1. collections : nom (1 à 40 caractères), visibilité 'private' (par
--    défaut : vous seul) ou 'friends' (vos amis : chacun suit l'autre).
--    Supprimée avec le compte.
-- 2. collection_items : une envie dans une collection (une seule fois par
--    collection ; une envie peut être dans plusieurs collections). Supprimée
--    avec la collection, avec l'envie, avec le compte. La base vérifie que
--    l'envie et la collection sont au même membre.
-- 3. collection_image_copies : la copie de l'image d'une envie montrée aux
--    amis (dans notre stockage, jamais l'adresse du marchand), une seule par
--    envie, tant qu'elle est dans au moins une collection « Mes amis ».
--    Supprimée avec l'envie et avec le compte ; le serveur efface le fichier.
-- 4. wishlist_items : une contrainte d'unicité (id, user_id), sans effet sur
--    les données (id est déjà unique), qui sert aux vérifications ci-dessus.
--
-- Facultative pour le serveur : sans elle, les routes des collections
-- répondent « indisponible » et l'app cache les collections (sonde du
-- schéma, lib/collections.ts). À appliquer d'abord sur spotto-dev-2
-- (migrer-dev), puis sur spotto-prod. Rejouable sans effet (if not exists) ;
-- ne supprime ni ne modifie aucune donnée existante.
-- Aucune règle d'accès public : seul le serveur, avec sa clé secrète, lit et
-- écrit ces tables (RLS active, aucune politique).

-- ---- Envies : (id, user_id) unique, pour les clés étrangères ci-dessous ----
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.wishlist_items'::regclass and conname = 'wishlist_items_id_user_id_key') then
    alter table wishlist_items add constraint wishlist_items_id_user_id_key unique (id, user_id);
  end if;
end;
$$;

-- ---- Collections ----
create table if not exists collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  visibility text not null default 'private' check (visibility in ('private', 'friends')),
  visibility_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index if not exists collections_user_idx on collections (user_id, created_at);
-- Collections montrées aux amis (profil d'un ami).
create index if not exists collections_user_friends_idx on collections (user_id) where visibility = 'friends';
alter table collections enable row level security;

-- ---- Envies d'une collection ----
create table if not exists collection_items (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null,
  wishlist_item_id uuid not null,
  -- Le membre (le même pour la collection et l'envie, vérifié par la base).
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (collection_id, wishlist_item_id),
  foreign key (collection_id, user_id) references collections (id, user_id) on delete cascade,
  foreign key (wishlist_item_id, user_id) references wishlist_items (id, user_id) on delete cascade
);
create index if not exists collection_items_collection_idx on collection_items (collection_id, created_at desc);
create index if not exists collection_items_wishlist_item_idx on collection_items (wishlist_item_id, user_id);
create index if not exists collection_items_user_idx on collection_items (user_id);
alter table collection_items enable row level security;

-- ---- Copie de l'image montrée aux amis (une par envie) ----
create table if not exists collection_image_copies (
  wishlist_item_id uuid primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  -- Copie dans notre stockage (post-media/<membre>/…), en deux tailles.
  image_url text not null,
  image_thumb_url text not null,
  created_at timestamptz not null default now(),
  foreign key (wishlist_item_id, user_id) references wishlist_items (id, user_id) on delete cascade
);
create index if not exists collection_image_copies_user_idx on collection_image_copies (user_id);
alter table collection_image_copies enable row level security;

-- Le serveur seul : ni les visiteurs, ni les comptes connectés.
revoke all on table collections, collection_items, collection_image_copies from public, anon, authenticated;
grant select, insert, update, delete on table collections, collection_items, collection_image_copies to service_role;

notify pgrst, 'reload schema';

-- ========================================================================
-- 0034_moderation_collections.sql
-- ========================================================================

-- 0034 (lot « modération des collections », 2026-11-09) : signaler une
-- collection montrée par un ami, et la modérer (règle 1.2 d'Apple).
--
-- Retour en arrière (le serveur actuel fonctionne sans 0034 ; redémarrez-le
-- ensuite pour qu'il relise la base). Les signalements de collections et les
-- décisions prises sur elles sont alors perdus ; une suspension décidée
-- depuis une collection signalée reste en place ; une image retirée le reste
-- (l'envie est montrée sans image, et une nouvelle copie sera faite) :
--   update moderation_actions set target_type = 'user', target_id = target_user_id
--     where target_type = 'collection' and action in ('suspend', 'unsuspend');
--   delete from notifications n using moderation_actions m
--     where n.moderation_action_id = m.id and m.target_type = 'collection';
--   delete from reports where target_type = 'collection';
--   delete from moderation_actions where target_type = 'collection';
--   drop function if exists moderation_remove_collection_image(uuid, uuid, uuid, text);
--   alter table collections drop column if exists hidden_at;
--   delete from collection_image_copies where image_removed_at is not null;
--   alter table collection_image_copies drop constraint if exists collection_image_copies_removed_check;
--   alter table collection_image_copies drop column if exists image_removed_at;
--   alter table collection_image_copies alter column image_url set not null;
--   alter table collection_image_copies alter column image_thumb_url set not null;
--   alter table reports drop constraint if exists reports_target_type_check;
--   alter table reports add constraint reports_target_type_check
--     check (target_type in ('user', 'post', 'comment', 'piece', 'message'));
--   alter table moderation_actions drop constraint if exists moderation_actions_target_type_check;
--   alter table moderation_actions add constraint moderation_actions_target_type_check
--     check (target_type in ('user', 'post', 'comment', 'piece', 'message'));
-- puis relancer le fichier 0030_masquage_automatique.sql en entier, puis le
-- fichier 0032_messages.sql en entier (dans cet ordre : ils remettent les
-- fonctions de la modération sans les collections).
--
-- Ce qu'elle ajoute :
-- 1. Le type 'collection' dans les signalements (reports) et le journal de la
--    modération (moderation_actions).
-- 2. collections.hidden_at : masquée par la modération (les amis ne la voient
--    plus ; son auteur ne peut pas la remontrer à ses amis tant qu'elle l'est).
-- 3. collection_image_copies.image_removed_at : la copie de l'image d'une
--    envie retirée par la modération. La ligne reste, sans adresse : l'envie
--    est montrée aux amis avec « Image indisponible », et aucune nouvelle
--    copie n'est faite (le fichier est effacé par le serveur AVANT).
-- 4. Les fonctions de la modération, reprises telles quelles, avec les
--    collections en plus : moderation_set_hidden et moderation_apply (version
--    de 0032), moderation_auto_hide (version de 0030 : masquage après 3
--    personnes différentes). Nouvelle : moderation_remove_collection_image.
--    moderation_undo et moderation_queue (0026, 0023) n'ont pas à changer.
--
-- Facultative pour le serveur : sans elle, « Signaler » est caché pour les
-- collections, un signalement de collection reçoit « indisponible », et les
-- collections fonctionnent comme avant (sonde du schéma,
-- lib/collectionModeration.ts). À appliquer APRÈS 0030, 0032 et 0033
-- (vérifié ci-dessous), d'abord sur spotto-dev-2 (migrer-dev), puis sur
-- spotto-prod. Ne relancez pas 0030 ni 0032 après 0034 (elles remettraient
-- les fonctions sans les collections) ; si c'est fait, relancez 0034.
-- Rejouable sans effet (if not exists, create or replace) ; ne supprime ni ne
-- modifie aucune donnée existante.

do $$
begin
  if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname = 'public' and p.proname = 'moderation_auto_hide') then
    raise exception 'Appliquez d''abord la migration 0030 (masquage automatique), puis 0032 et 0033, puis relancez 0034.';
  end if;
  if to_regclass('public.messages') is null then
    raise exception 'Appliquez d''abord la migration 0032 (messages privés), puis 0033, puis relancez 0034.';
  end if;
  if to_regclass('public.collections') is null or to_regclass('public.collection_image_copies') is null then
    raise exception 'Appliquez d''abord la migration 0033 (collections), puis relancez 0034.';
  end if;
end;
$$;

-- ---- Signaler une collection ----
alter table reports drop constraint if exists reports_target_type_check;
alter table reports add constraint reports_target_type_check
  check (target_type in ('user', 'post', 'comment', 'piece', 'message', 'collection'));
alter table moderation_actions drop constraint if exists moderation_actions_target_type_check;
alter table moderation_actions add constraint moderation_actions_target_type_check
  check (target_type in ('user', 'post', 'comment', 'piece', 'message', 'collection'));

-- ---- Collection masquée par la modération ----
alter table collections add column if not exists hidden_at timestamptz;

-- ---- Copie d'une image retirée par la modération ----
alter table collection_image_copies add column if not exists image_removed_at timestamptz;
alter table collection_image_copies alter column image_url drop not null;
alter table collection_image_copies alter column image_thumb_url drop not null;
-- Les deux adresses, ou (retirée) aucune : jamais une image à moitié.
alter table collection_image_copies drop constraint if exists collection_image_copies_removed_check;
alter table collection_image_copies add constraint collection_image_copies_removed_check
  check ((image_removed_at is null and image_url is not null and image_thumb_url is not null)
      or (image_removed_at is not null and image_url is null and image_thumb_url is null));

-- Masquer (p_at = maintenant) ou rétablir (p_at = null) un contenu. Reprend
-- la version de la migration 0032 et ajoute la collection.
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
  elsif p_target_type = 'collection' then
    update collections set hidden_at = p_at where id = p_target_id;
  end if;
end;
$$;

-- Une décision d'administrateur, en une seule transaction. Reprend la
-- version de la migration 0032 ; seul ajout : la collection (personne
-- concernée : celle à qui elle appartient).
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
     or p_target_type is null or p_target_type not in ('user', 'post', 'comment', 'piece', 'message', 'collection')
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
    when 'collection' then (select k.user_id from collections k where k.id = p_target_id)
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
    when 'collection' then exists (select 1 from collections k where k.id = p_target_id and k.hidden_at is not null)
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

-- Masquage automatique, en une seule transaction. Reprend la version de la
-- migration 0030 ; seul ajout : la collection (que seuls des amis de son
-- auteur peuvent signaler).
create or replace function moderation_auto_hide(p_target_type text, p_target_id uuid, p_threshold integer)
returns table (outcome text, action_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_user uuid;
  v_hidden timestamptz;
  v_since timestamptz;
  v_reporters integer;
  v_reason text;
  v_action uuid;
begin
  perform pg_advisory_xact_lock(hashtext('spotto_moderation'));
  if p_target_type is null or p_target_type not in ('post', 'comment', 'piece', 'collection') or coalesce(p_threshold, 0) < 2 then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  if p_target_type = 'post' then
    select p.user_id, p.hidden_at into v_user, v_hidden from posts p where p.id = p_target_id;
  elsif p_target_type = 'comment' then
    select c.user_id, c.hidden_at into v_user, v_hidden from comments c where c.id = p_target_id;
  elsif p_target_type = 'collection' then
    select k.user_id, k.hidden_at into v_user, v_hidden from collections k where k.id = p_target_id;
  else
    select s.sender_id, s.hidden_at into v_user, v_hidden from piece_sends s where s.id = p_target_id;
  end if;
  if v_user is null then
    return query select 'target_not_found'::text, null::uuid;
    return;
  end if;
  if v_hidden is not null then
    return query select 'already_hidden'::text, null::uuid;
    return;
  end if;

  -- Un contenu rétabli par un administrateur ne se remasque qu'avec de
  -- NOUVEAUX signalements, faits après ce rétablissement.
  select max(m.created_at) into v_since
    from moderation_actions m
    where m.target_type = p_target_type and m.target_id = p_target_id and m.action = 'restore';

  -- Signalements qui comptent, contre les masquages abusifs (relecture
  -- sécurité du chantier 3) :
  -- - pas ceux d'un compte créé depuis moins d'un jour au moment du
  --   signalement : trois comptes jetables, créés à la minute, ne font plus
  --   disparaître le contenu de quelqu'un ;
  -- - pas ceux d'un compte suspendu (il peut encore signaler, mais ne masque
  --   plus rien) ;
  -- - pas ceux d'une personne dont un administrateur a déjà traité un
  --   signalement de ce contenu, ou qui l'avait signalé avant son
  --   rétablissement : un contenu rétabli ou « classé sans suite » ne peut
  --   pas être remasqué aussitôt par les mêmes personnes (rien n'empêche de
  --   signaler deux fois). Il faut trois personnes nouvelles.
  with eligible as (
    select r.reporter_id, r.reason
      from reports r
      join profiles p on p.id = r.reporter_id
      where r.target_type = p_target_type and r.target_id = p_target_id
        and r.handled_at is null
        and r.reporter_id <> v_user
        and (v_since is null or r.created_at > v_since)
        and r.created_at >= p.created_at + interval '1 day'
        and not exists (select 1 from suspensions s where s.user_id = r.reporter_id)
        and not exists (
          select 1 from reports o
          where o.target_type = p_target_type and o.target_id = p_target_id and o.reporter_id = r.reporter_id
            and (o.handled_at is not null or (v_since is not null and o.created_at <= v_since))
        )
  )
  select
    (select count(distinct e.reporter_id)::integer from eligible e),
    -- Motif : le plus fréquent parmi ces signalements.
    (select e.reason from eligible e group by e.reason order by count(*) desc, e.reason limit 1)
    into v_reporters, v_reason;
  if v_reporters < p_threshold then
    return query select 'below_threshold'::text, null::uuid;
    return;
  end if;

  insert into moderation_actions (admin_id, action, target_type, target_id, target_user_id, reason, note, automatic)
    values (null, 'hide', p_target_type, p_target_id, v_user, v_reason, null, true)
    returning id into v_action;
  perform moderation_set_hidden(p_target_type, p_target_id, now());
  insert into notifications (user_id, actor_id, type, moderation_action_id) values (v_user, null, 'moderation', v_action);

  return query select 'ok'::text, v_action;
end;
$$;

-- Retirer la copie de l'image d'une envie d'une collection, en une seule
-- opération (comme moderation_remove_image, migration 0026) : adresses
-- vidées, date du retrait, décision au journal (sur la collection), personne
-- prévenue avec le motif neutre « droits sur l'image », signalements de la
-- collection classés. Le serveur a déjà effacé les fichiers. outcome :
-- « ok », ou la raison du refus (not_admin, target_not_found, no_copy,
-- already_removed). Ne s'annule pas (moderation_undo : « not_undoable »).
create or replace function moderation_remove_collection_image(p_admin_id uuid, p_collection_id uuid, p_item_id uuid, p_note text)
returns table (outcome text, action_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_owner uuid;
  v_wish uuid;
  v_found boolean;
  v_removed timestamptz;
  v_action uuid;
begin
  perform pg_advisory_xact_lock(hashtext('spotto_moderation'));
  if not exists (select 1 from admins a where a.user_id = p_admin_id) then
    return query select 'not_admin'::text, null::uuid;
    return;
  end if;
  select i.user_id, i.wishlist_item_id into v_owner, v_wish
    from collection_items i where i.id = p_item_id and i.collection_id = p_collection_id;
  if v_owner is null then
    return query select 'target_not_found'::text, null::uuid;
    return;
  end if;
  select true, c.image_removed_at into v_found, v_removed
    from collection_image_copies c where c.wishlist_item_id = v_wish and c.user_id = v_owner for update;
  if v_found is null then
    return query select 'no_copy'::text, null::uuid;
    return;
  end if;
  if v_removed is not null then
    return query select 'already_removed'::text, null::uuid;
    return;
  end if;

  insert into moderation_actions (admin_id, action, target_type, target_id, target_user_id, reason, note)
    values (p_admin_id, 'remove_image', 'collection', p_collection_id, v_owner, 'image_rights', nullif(btrim(p_note), ''))
    returning id into v_action;
  update collection_image_copies set image_url = null, image_thumb_url = null, image_removed_at = now()
    where wishlist_item_id = v_wish and user_id = v_owner;
  insert into notifications (user_id, actor_id, type, moderation_action_id) values (v_owner, null, 'moderation', v_action);

  with handled as (
    update reports r set handled_at = now(), moderation_action_id = v_action
    where r.target_type = 'collection' and r.target_id = p_collection_id and r.handled_at is null
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
revoke all on function moderation_auto_hide(text, uuid, integer) from public, anon, authenticated;
grant execute on function moderation_auto_hide(text, uuid, integer) to service_role;
revoke all on function moderation_remove_collection_image(uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function moderation_remove_collection_image(uuid, uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
