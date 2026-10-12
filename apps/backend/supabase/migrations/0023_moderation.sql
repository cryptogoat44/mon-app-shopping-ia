-- Lot 5, section 5.B (décision du fondateur, 2026-10-11) : modération
-- minimaliste, visible des seuls administrateurs. Pour les autres comptes,
-- rien ne change : signaler et bloquer.

-- Administrateurs : table dédiée, jamais une colonne du profil (aucune route
-- de mise à jour du profil ne peut y écrire). Attribution par une requête SQL
-- manuelle seulement, faite par le fondateur.
create table if not exists admins (
  user_id uuid primary key references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table admins enable row level security;

-- Journal des décisions (qui, quoi, quand, motif), en ajout seulement :
-- annuler une décision ajoute une ligne qui renvoie à la décision annulée.
-- target_user_id : la personne concernée (auteur du contenu, ou le compte).
create table if not exists moderation_actions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid references profiles(id) on delete set null,
  action text not null check (action in ('dismiss', 'hide', 'suspend', 'restore', 'unsuspend')),
  target_type text not null check (target_type in ('user', 'post', 'comment')),
  target_id uuid not null,
  target_user_id uuid references profiles(id) on delete cascade,
  reason text check (reason is null or reason in ('spam', 'inappropriate', 'harassment', 'other')),
  note text check (note is null or char_length(note) <= 500),
  undoes_action_id uuid references moderation_actions(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists moderation_actions_admin_id_idx on moderation_actions (admin_id);
create index if not exists moderation_actions_target_user_id_idx on moderation_actions (target_user_id);
create index if not exists moderation_actions_undoes_action_id_idx on moderation_actions (undoes_action_id);
create index if not exists moderation_actions_target_idx on moderation_actions (target_type, target_id, created_at desc);
alter table moderation_actions enable row level security;

-- Comptes suspendus : table dédiée, jamais une colonne du profil.
create table if not exists suspensions (
  user_id uuid primary key references profiles(id) on delete cascade,
  moderation_action_id uuid not null references moderation_actions(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists suspensions_moderation_action_id_idx on suspensions (moderation_action_id);
alter table suspensions enable row level security;

-- Publications masquées (les commentaires ont déjà hidden_at, migration 0017).
alter table posts add column if not exists hidden_at timestamptz;

-- Signalements traités : par quelle décision, et quand.
alter table reports add column if not exists handled_at timestamptz;
alter table reports add column if not exists moderation_action_id uuid references moderation_actions(id) on delete set null;
create index if not exists reports_moderation_action_id_idx on reports (moderation_action_id);

-- Notifications de la modération, sans auteur affiché : à la personne
-- concernée (contenu masqué ou rétabli, compte suspendu ou rétabli) et aux
-- auteurs des signalements (traités). hidden_at : une notification qui parle
-- d'un contenu masqué l'est avec lui (réversible).
alter table notifications alter column actor_id drop not null;
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check
  check (type in ('follow', 'like', 'comment', 'moderation', 'report_handled'));
alter table notifications drop constraint if exists notifications_actor_check;
alter table notifications add constraint notifications_actor_check
  check (actor_id is not null or type in ('moderation', 'report_handled'));
-- Décision supprimée (avec le compte de la personne concernée) : les
-- notifications « signalement traité » des autres comptes restent.
alter table notifications add column if not exists moderation_action_id uuid;
alter table notifications drop constraint if exists notifications_moderation_action_id_fkey;
alter table notifications add constraint notifications_moderation_action_id_fkey
  foreign key (moderation_action_id) references moderation_actions(id) on delete set null;
create index if not exists notifications_moderation_action_id_idx on notifications (moderation_action_id);
alter table notifications add column if not exists hidden_at timestamptz;

-- Masquer (p_at = maintenant) ou rétablir (p_at = null) une publication ou un
-- commentaire, avec les notifications qui en parlent. Un rétablissement ne
-- fait jamais réapparaître ce qui reste masqué par ailleurs (commentaire
-- masqué sous une publication rétablie, et l'inverse).
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
  end if;
end;
$$;

-- Une décision, en une seule transaction : contenu masqué ou compte suspendu,
-- signalements du contenu marqués traités, information de la personne
-- concernée (jamais pour un classement sans suite) et des auteurs des
-- signalements (une fois chacun). Un contenu supprimé depuis (ou un compte
-- supprimé) ne peut qu'être classé sans suite, pour clore ses signalements.
-- Les décisions passent une à une (verrou) : deux administrateurs ne peuvent
-- pas masquer ou suspendre deux fois. outcome : « ok », ou la raison du refus.
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
     or p_target_type is null or p_target_type not in ('user', 'post', 'comment')
     or (p_action = 'hide' and p_target_type = 'user')
     or (p_action in ('hide', 'suspend') and p_reason is null) then
    return query select 'invalid'::text, null::uuid;
    return;
  end if;

  v_user := case p_target_type
    when 'post' then (select p.user_id from posts p where p.id = p_target_id)
    when 'comment' then (select c.user_id from comments c where c.id = p_target_id)
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
    or (p_target_type = 'comment' and exists (select 1 from comments c where c.id = p_target_id and c.hidden_at is not null))) then
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

-- Annuler une décision encore en vigueur (rétablir un contenu, lever une
-- suspension) : une nouvelle ligne du journal ; la personne concernée en est
-- informée. outcome : « ok », ou la raison du refus.
create or replace function moderation_undo(p_admin_id uuid, p_action_id uuid, p_note text)
returns table (outcome text, action_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_original moderation_actions%rowtype;
  v_undo text;
  v_action uuid;
begin
  perform pg_advisory_xact_lock(hashtext('spotto_moderation'));
  if not exists (select 1 from admins a where a.user_id = p_admin_id) then
    return query select 'not_admin'::text, null::uuid;
    return;
  end if;
  select * into v_original from moderation_actions m where m.id = p_action_id;
  if not found or v_original.action not in ('hide', 'suspend') then
    return query select 'target_not_found'::text, null::uuid;
    return;
  end if;
  if exists (select 1 from moderation_actions m where m.undoes_action_id = p_action_id)
     or (v_original.action = 'suspend' and not exists (select 1 from suspensions s where s.moderation_action_id = p_action_id)) then
    return query select 'already_undone'::text, null::uuid;
    return;
  end if;

  v_undo := case v_original.action when 'hide' then 'restore' else 'unsuspend' end;
  insert into moderation_actions (admin_id, action, target_type, target_id, target_user_id, note, undoes_action_id)
    values (p_admin_id, v_undo, v_original.target_type, v_original.target_id, v_original.target_user_id, nullif(btrim(p_note), ''), p_action_id)
    returning id into v_action;

  if v_undo = 'restore' then
    perform moderation_set_hidden(v_original.target_type, v_original.target_id, null);
  else
    delete from suspensions s where s.moderation_action_id = p_action_id;
  end if;
  insert into notifications (user_id, actor_id, type, moderation_action_id)
    values (v_original.target_user_id, null, 'moderation', v_action);

  return query select 'ok'::text, v_action;
end;
$$;

-- File des signalements regroupés par contenu, du plus récent au plus ancien :
-- « À traiter » (p_handled = false) ou « Traités » (true) ; au plus 50 par page.
create or replace function moderation_queue(p_handled boolean, p_before timestamptz default null, p_limit integer default 20)
returns table (target_type text, target_id uuid, report_count integer, reasons jsonb, notes text[], first_at timestamptz, last_at timestamptz)
language sql
stable
set search_path = public
as $$
  with base as (
    select r.target_type, r.target_id, r.reason, r.note, r.created_at
    from reports r
    where (r.handled_at is not null) = p_handled
  ), per_reason as (
    select b.target_type, b.target_id, b.reason, count(*)::integer as n
    from base b
    group by b.target_type, b.target_id, b.reason
  ), grouped as (
    select b.target_type, b.target_id, count(*)::integer as report_count,
           (array_agg(b.note order by b.created_at desc) filter (where b.note is not null))[1:5] as notes,
           min(b.created_at) as first_at, max(b.created_at) as last_at
    from base b
    group by b.target_type, b.target_id
  )
  select g.target_type, g.target_id, g.report_count,
         (select jsonb_object_agg(pr.reason, pr.n) from per_reason pr where pr.target_type = g.target_type and pr.target_id = g.target_id),
         coalesce(g.notes, '{}'::text[]), g.first_at, g.last_at
  from grouped g
  where p_before is null or g.last_at < p_before
  order by g.last_at desc, g.target_id
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

-- Le serveur seul : ni les visiteurs, ni les comptes connectés.
revoke all on function moderation_set_hidden(text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function moderation_set_hidden(text, uuid, timestamptz) to service_role;
revoke all on function moderation_apply(uuid, text, text, uuid, text, text) from public, anon, authenticated;
grant execute on function moderation_apply(uuid, text, text, uuid, text, text) to service_role;
revoke all on function moderation_undo(uuid, uuid, text) from public, anon, authenticated;
grant execute on function moderation_undo(uuid, uuid, text) to service_role;
revoke all on function moderation_queue(boolean, timestamptz, integer) from public, anon, authenticated;
grant execute on function moderation_queue(boolean, timestamptz, integer) to service_role;

notify pgrst, 'reload schema';
