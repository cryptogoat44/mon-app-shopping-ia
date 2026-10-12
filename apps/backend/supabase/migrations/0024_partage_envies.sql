-- Lot 5, section 5.C (décisions du fondateur, 2026-10-12) : partager une
-- envie. Les envies restent privées par défaut ; chaque partage est un geste
-- volontaire : republier sur son profil (publication « envie »), envoyer à
-- une personne sur Spotto (pièces « Reçues »), ou partager hors de l'app
-- (rien à enregistrer ici).
--
-- Images (décision du fondateur : « exactement comme Instagram ») : une image
-- venue d'un autre site n'est jamais affichée telle quelle. Au moment du
-- partage, le serveur la télécharge une fois, la ré-encode et en range une
-- copie dans notre stockage (post-media/<auteur>/…) ; c'est cette copie qui
-- est montrée. Aucun site tiers ne voit donc l'adresse IP de qui regarde.

-- ---- Publication « envie » ----
-- La valeur s'ajoute au type existant ; elle n'est jamais citée telle quelle
-- dans ce fichier (une valeur ajoutée n'est utilisable qu'après validation de
-- la transaction) : les règles ci-dessous comparent le texte du type.
alter type post_type add value if not exists 'wish';

-- La publication suit son envie : retirer l'envie la supprime aussi (même
-- règle que la publication « achat » et sa pièce du Vault, migration 0014).
alter table posts add column if not exists wishlist_item_id uuid;
alter table posts drop constraint if exists posts_wishlist_item_id_fkey;
alter table posts add constraint posts_wishlist_item_id_fkey
  foreign key (wishlist_item_id) references wishlist_items(id) on delete cascade;
-- Une envie ne se republie qu'une fois à la fois (comme un achat), y compris
-- si sa publication a été masquée par la modération.
create unique index if not exists posts_wishlist_item_id_key on posts (wishlist_item_id) where wishlist_item_id is not null;

-- Ancienne règle (0001) : « lifestyle ou vault_item_id renseigné ». Remplacée
-- par une règle par type, qui interdit aussi tout mélange.
do $$
declare
  r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.posts'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%vault_item_id IS NOT NULL%'
      and conname <> 'posts_type_source_check'
  loop
    execute format('alter table posts drop constraint %I', r.conname);
  end loop;
end;
$$;
alter table posts drop constraint if exists posts_type_source_check;
alter table posts add constraint posts_type_source_check check (
  (type::text = 'lifestyle' and wishlist_item_id is null)
  or (type::text = 'purchase' and vault_item_id is not null and wishlist_item_id is null)
  or (type::text = 'wish' and wishlist_item_id is not null and vault_item_id is null)
);

-- ---- Pièces envoyées à une personne ----
-- Un instantané de l'envie au moment de l'envoi : la personne qui la reçoit
-- la garde même si l'envie est retirée ensuite. L'image est la copie faite
-- par notre serveur (jamais l'adresse d'origine). Supprimée avec le compte de
-- l'une ou l'autre personne. hidden_at : masquage par la modération.
create table if not exists piece_sends (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references profiles(id) on delete cascade,
  recipient_id uuid not null references profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  image_url text not null,
  image_thumb_url text not null,
  merchant_name text check (merchant_name is null or char_length(merchant_name) <= 120),
  merchant_url text check (merchant_url is null or char_length(merchant_url) <= 2048),
  product_match_id uuid references product_matches(id) on delete set null,
  price_min numeric(10,2),
  currency char(3),
  hidden_at timestamptz,
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);
create index if not exists piece_sends_recipient_idx on piece_sends (recipient_id, created_at desc);
create index if not exists piece_sends_sender_idx on piece_sends (sender_id, created_at desc);
create index if not exists piece_sends_product_match_id_idx on piece_sends (product_match_id);
-- Aucune règle d'accès public : seul le serveur, avec sa clé secrète, lit et écrit.
alter table piece_sends enable row level security;

-- ---- Réglage « Qui peut m'envoyer des pièces » ----
-- following : les comptes que je suis (par défaut) ; everyone : tout le
-- monde ; nobody : personne.
alter table profiles add column if not exists piece_sends_from text not null default 'following';
alter table profiles drop constraint if exists profiles_piece_sends_from_check;
alter table profiles add constraint profiles_piece_sends_from_check
  check (piece_sends_from in ('following', 'everyone', 'nobody'));

-- ---- Notification « vous a envoyé une pièce » (in-app, jamais push) ----
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('follow', 'like', 'comment', 'moderation', 'report_handled', 'piece_received'));
alter table notifications add column if not exists piece_send_id uuid;
alter table notifications drop constraint if exists notifications_piece_send_id_fkey;
alter table notifications add constraint notifications_piece_send_id_fkey
  foreign key (piece_send_id) references piece_sends(id) on delete cascade;
create index if not exists notifications_piece_send_id_idx on notifications (piece_send_id);

-- ---- Clic vers le marchand depuis une pièce reçue ----
alter table affiliate_clicks drop constraint if exists affiliate_clicks_context_check;
alter table affiliate_clicks add constraint affiliate_clicks_context_check
  check (context is null or context in ('result', 'similar', 'vault', 'wishlist', 'post', 'price_alert', 'received'));

-- ---- Signalement et modération d'une pièce envoyée ----
alter table reports drop constraint if exists reports_target_type_check;
alter table reports add constraint reports_target_type_check
  check (target_type in ('user', 'post', 'comment', 'piece'));
alter table moderation_actions drop constraint if exists moderation_actions_target_type_check;
alter table moderation_actions add constraint moderation_actions_target_type_check
  check (target_type in ('user', 'post', 'comment', 'piece'));

-- Masquer (p_at = maintenant) ou rétablir (p_at = null) un contenu, avec les
-- notifications qui en parlent. Reprend la version de la migration 0023 et
-- ajoute la pièce envoyée.
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
  end if;
end;
$$;

-- Une décision, en une seule transaction. Reprend la version de la migration
-- 0023 et ajoute la pièce envoyée (personne concernée : celle qui l'a envoyée).
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
  if p_action = 'hide' and (
       (p_target_type = 'post' and exists (select 1 from posts p where p.id = p_target_id and p.hidden_at is not null))
    or (p_target_type = 'comment' and exists (select 1 from comments c where c.id = p_target_id and c.hidden_at is not null))
    or (p_target_type = 'piece' and exists (select 1 from piece_sends s where s.id = p_target_id and s.hidden_at is not null))) then
    return query select 'already_hidden'::text, null::uuid;
    return;
  end if;
  if p_action = 'suspend' and exists (select 1 from suspensions s where s.user_id = v_user) then
    return query select 'already_suspended'::text, null::uuid;
    return;
  end if;

  insert into moderation_actions (admin_id, action, target_type, target_id, target_user_id, reason, note)
    values (p_admin_id, p_action, p_target_type, p_target_id, v_user, p_reason, nullif(btrim(p_note), ''))
    returning id into v_action;

  if p_action = 'hide' then
    perform moderation_set_hidden(p_target_type, p_target_id, now());
  elsif p_action = 'suspend' then
    insert into suspensions (user_id, moderation_action_id) values (v_user, v_action);
  end if;

  if p_action <> 'dismiss' then
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
