-- ============================================================================
-- MISE EN LIGNE DU LOT 5 (et du lot 4 quater) — PRODUCTION
-- ============================================================================
-- À coller dans l'éditeur SQL du projet de PRODUCTION : l'adresse de la page
-- doit contenir selhqdqfrflsqivgxypf (spotto-prod, production depuis le 28 octobre 2026 ;
-- jamais sedfepcpmhilaxbrgdif = spotto-dev-2, ni les anciens projets qcwnlqkxnhqpyjpkooiw et sbtwsmxfdfxzgcohbznd).
--
-- Ce fichier enchaîne, dans l'ordre, les trois migrations déjà appliquées et
-- vérifiées sur spotto-dev (texte identique à supabase/migrations/) :
--   0022 — plafond global des recherches SerpApi (lot 4 quater) ;
--   0023 — modération minimaliste (lot 5, 5.B) ;
--   0024 — partage d'une envie (lot 5, 5.C) ;
-- puis affiche une vérification finale (une seule ligne, tout à « true »).
--
-- Aucune donnée existante n'est effacée ni réécrite (relecture du
-- 2026-10-12) : les « drop » ne retirent que d'anciennes versions de
-- fonctions et de règles, recréées aussitôt. L'éditeur peut afficher un
-- avertissement « destructive operation » : cliquer « Run this query ».
--
-- QUAND LE RELANCER :
-- - s'il s'est arrêté sur une erreur : tout est annulé, on peut le relancer
--   tel quel (après avoir montré l'erreur à Claude) ;
-- - une fois passé AVEC SUCCÈS : NE PLUS LE RELANCER EN ENTIER (une ancienne
--   règle de 0023 refuserait alors les notifications « pièce reçue ») ; pour
--   revérifier, lancer seulement supabase/mise-en-ligne/lot-5-verification.sql.
--
-- Le rôle d'administrateur du fondateur reste une étape à part
-- (docs/0023-admin.sql, sur le Mac du fondateur : il contient son e-mail et
-- ne doit pas être publié dans ce dépôt public).
-- ============================================================================

-- Si une table est occupée plus de 10 s, la mise en ligne s'arrête (tout est
-- annulé) au lieu de faire attendre l'app : il suffit alors de la relancer.
set local lock_timeout = '10s';

-- ============================================================================
-- 0022_serpapi_quota.sql
-- ============================================================================

-- Lot 4 quater (décisions du fondateur, 2026-10-08) : plafond GLOBAL des
-- recherches SerpApi, par jour (heure de Paris) et par CYCLE MENSUEL aligné sur
-- le jour de renouvellement du quota chez SerpApi (le 3 en octobre 2026), et
-- PART DE CHAQUE PERSONNE par jour, en plus des limites par personne existantes
-- (lib/rateLimits.ts). Tout est compté dans la base : en mémoire, les compteurs
-- repartiraient de zéro à chaque redémarrage du serveur (mise en veille de
-- l'offre gratuite de Render, déploiements).
--
-- Plafond global : une ligne par appel réservé, avec sa seule date — ni
-- compte, ni adresse, ni contenu : aucune donnée personnelle, donc rien à
-- exporter ni à effacer avec un compte. Lue et écrite uniquement par le
-- serveur (clé service_role) : RLS active, aucune politique ; aucune clé
-- étrangère.
create table if not exists serpapi_calls (
  id bigint generated always as identity primary key,
  called_at timestamptz not null default now()
);
create index if not exists serpapi_calls_called_at_idx on serpapi_calls (called_at);
alter table serpapi_calls enable row level security;

-- Écritures précédentes des fonctions (spotto-dev seulement, jamais en production).
drop function if exists serpapi_quota(integer, integer, boolean, timestamptz);
drop function if exists serpapi_quota(integer, integer, integer, uuid, boolean, uuid, timestamptz);
drop function if exists serpapi_quota(integer, integer, integer, integer, uuid, boolean, uuid, timestamptz);

-- Jour de renouvellement dans le mois de p_month : le jour p_renewal_day, ou
-- le dernier jour d'un mois plus court (le 31 : le 30 avril, le 28 ou le 29
-- février).
create or replace function serpapi_renewal_in_month(p_renewal_day integer, p_month date)
returns date
language plpgsql
stable
set search_path = public
as $$
declare
  v_first date := date_trunc('month', p_month)::date;
begin
  if p_renewal_day is null or p_renewal_day < 1 or p_renewal_day > 31 or p_month is null then
    raise exception 'serpapi_renewal_in_month : paramètres invalides';
  end if;
  return v_first + (least(p_renewal_day, extract(day from (v_first + interval '1 month - 1 day'))::integer) - 1);
end;
$$;

-- Début du cycle en cours : minuit (heure de Paris) du dernier jour de
-- renouvellement passé, ou d'aujourd'hui. Le 2 janvier, avec un renouvellement
-- le 3, le cycle a commencé le 3 décembre de l'année précédente.
create or replace function serpapi_cycle_start(p_renewal_day integer, p_at timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = public
as $$
declare
  v_today date;
  v_renewal date;
begin
  if p_at is null then
    raise exception 'serpapi_cycle_start : paramètres invalides';
  end if;
  v_today := (p_at at time zone 'Europe/Paris')::date;
  v_renewal := serpapi_renewal_in_month(p_renewal_day, v_today);
  if v_renewal > v_today then
    v_renewal := serpapi_renewal_in_month(p_renewal_day, (v_today - interval '1 month')::date);
  end if;
  return v_renewal::timestamp at time zone 'Europe/Paris';
end;
$$;

-- Prochain renouvellement (date de Paris), quand le plafond du mois se libère :
-- le jour de renouvellement du mois qui suit le début du cycle en cours.
create or replace function serpapi_next_renewal(p_renewal_day integer, p_at timestamptz)
returns date
language plpgsql
stable
set search_path = public
as $$
begin
  return serpapi_renewal_in_month(
    p_renewal_day,
    ((serpapi_cycle_start(p_renewal_day, p_at) at time zone 'Europe/Paris')::date + interval '1 month')::date
  );
end;
$$;

-- Réserve un appel (p_reserve = true), ou lit seulement l'état (false), pour
-- la personne p_user_id. Trois plafonds, dans cet ordre : le mois (tout le
-- service, depuis le début du cycle de SerpApi : il se libère quand le quota
-- de SerpApi revient, le jour next_renewal), la part de la personne pour la
-- journée, le jour (tout le service) ; refused_by dit lequel est atteint.
-- La part de la personne compte ses recherches du jour qui ont atteint
-- SerpApi (en cours, abouties ou non), lues dans product_searches — aucune
-- donnée personnelle de plus ; p_exclude_search : la recherche en cours de
-- lancement, déjà marquée « en cours ».
-- Atomique : un verrou de transaction met les demandes en file, et l'instant
-- de référence est lu APRÈS ce verrou (lu avant, une demande en attente
-- ignorait les appels réservés juste avant elle — trouvé par un test).
-- p_at : un instant fixé, pour les tests seulement (dans le passé, jamais mêlé
-- aux vrais appels) ; le serveur ne le donne jamais.
create or replace function serpapi_quota(
  p_daily_cap integer,
  p_monthly_cap integer,
  p_user_daily_cap integer,
  p_renewal_day integer,
  p_user_id uuid,
  p_reserve boolean,
  p_exclude_search uuid default null,
  p_at timestamptz default null
)
returns table (allowed boolean, refused_by text, day_count integer, month_count integer, user_day_count integer, next_renewal date)
language plpgsql
set search_path = public
as $$
declare
  v_at timestamptz;
  v_day_start timestamptz;
  v_cycle_start timestamptz;
  v_next date;
  v_day integer;
  v_month integer;
  v_user integer;
begin
  if p_daily_cap is null or p_monthly_cap is null or p_user_daily_cap is null or p_user_id is null
     or p_daily_cap < 1 or p_monthly_cap < 1 or p_user_daily_cap < 1 then
    raise exception 'serpapi_quota : paramètres invalides';
  end if;
  perform pg_advisory_xact_lock(hashtext('serpapi_quota'));
  v_at := coalesce(p_at, clock_timestamp());
  v_day_start := date_trunc('day', v_at at time zone 'Europe/Paris') at time zone 'Europe/Paris';
  v_cycle_start := serpapi_cycle_start(p_renewal_day, v_at);
  v_next := serpapi_next_renewal(p_renewal_day, v_at);

  -- Le jour commence toujours dans le cycle en cours (au plus tôt, avec lui).
  select count(*) filter (where c.called_at >= v_day_start), count(*)
    into v_day, v_month
    from serpapi_calls c
    where c.called_at >= v_cycle_start and c.called_at <= v_at;

  select count(*)
    into v_user
    from product_searches s
    where s.user_id = p_user_id
      and s.status in ('processing', 'completed', 'failed')
      and s.created_at >= v_day_start and s.created_at <= v_at
      and s.id is distinct from p_exclude_search;

  if v_month >= p_monthly_cap then
    return query select false, 'month'::text, v_day, v_month, v_user, v_next;
    return;
  end if;
  if v_user >= p_user_daily_cap then
    return query select false, 'user'::text, v_day, v_month, v_user, v_next;
    return;
  end if;
  if v_day >= p_daily_cap then
    return query select false, 'day'::text, v_day, v_month, v_user, v_next;
    return;
  end if;

  if p_reserve then
    insert into serpapi_calls (called_at) values (v_at);
    v_day := v_day + 1;
    v_month := v_month + 1;
    v_user := v_user + 1;
  end if;
  return query select true, null::text, v_day, v_month, v_user, v_next;
end;
$$;

-- Premier démarrage : le compteur part de zéro, alors que SerpApi a peut-être
-- déjà compté des recherches dans le cycle en cours (avant le compteur, ou par
-- les outils d'essai). À la mise en ligne, le fondateur reporte le nombre lu
-- chez SerpApi (fichier docs/0022-amorcage.sql, écrit à ce moment-là) : autant
-- d'appels, datés du début du cycle. Sans effet si le cycle compte déjà des
-- appels (jamais en double). Renvoie le total du cycle.
create or replace function serpapi_seed_cycle(p_renewal_day integer, p_count integer, p_at timestamptz default null)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_at timestamptz;
  v_start timestamptz;
  v_total integer;
begin
  if p_count is null or p_count < 0 or p_count > 100000 then
    raise exception 'serpapi_seed_cycle : nombre invalide';
  end if;
  perform pg_advisory_xact_lock(hashtext('serpapi_quota'));
  v_at := coalesce(p_at, clock_timestamp());
  v_start := serpapi_cycle_start(p_renewal_day, v_at);
  select count(*) into v_total from serpapi_calls where called_at >= v_start and called_at <= v_at;
  if v_total = 0 and p_count > 0 then
    insert into serpapi_calls (called_at) select v_start from generate_series(1, p_count);
    v_total := p_count;
  end if;
  return v_total;
end;
$$;

-- Le serveur seul : ni les visiteurs, ni les comptes connectés.
revoke all on function serpapi_renewal_in_month(integer, date) from public, anon, authenticated;
grant execute on function serpapi_renewal_in_month(integer, date) to service_role;
revoke all on function serpapi_cycle_start(integer, timestamptz) from public, anon, authenticated;
grant execute on function serpapi_cycle_start(integer, timestamptz) to service_role;
revoke all on function serpapi_next_renewal(integer, timestamptz) from public, anon, authenticated;
grant execute on function serpapi_next_renewal(integer, timestamptz) to service_role;
revoke all on function serpapi_quota(integer, integer, integer, integer, uuid, boolean, uuid, timestamptz) from public, anon, authenticated;
grant execute on function serpapi_quota(integer, integer, integer, integer, uuid, boolean, uuid, timestamptz) to service_role;
revoke all on function serpapi_seed_cycle(integer, integer, timestamptz) from public, anon, authenticated;
grant execute on function serpapi_seed_cycle(integer, integer, timestamptz) to service_role;

notify pgrst, 'reload schema';


-- ============================================================================
-- 0023_moderation.sql
-- ============================================================================

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


-- ============================================================================
-- 0024_partage_envies.sql
-- ============================================================================

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


-- ============================================================================
-- VÉRIFICATION FINALE — une seule ligne attendue, toutes les colonnes à true.
-- ============================================================================
select
  -- 0022 : table des appels SerpApi (protégée), fonction du plafond.
  exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'serpapi_calls') as plafond_table,
  exists (select 1 from pg_proc where proname = 'serpapi_quota') as plafond_fonction,
  -- 0023 : administrateurs, journal des décisions, suspensions — protégés, sans règle d'accès public.
  (select count(*) = 3 from pg_tables where schemaname = 'public' and tablename in ('admins', 'moderation_actions', 'suspensions')) as moderation_tables,
  (select count(*) = 0 from pg_policies where schemaname = 'public' and tablename in ('admins', 'moderation_actions', 'suspensions', 'serpapi_calls', 'piece_sends')) as aucune_regle_publique,
  (
    select count(*) = 3 from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'posts' and column_name = 'hidden_at')
        or (table_name = 'reports' and column_name = 'handled_at')
        or (table_name = 'notifications' and column_name = 'moderation_action_id'))
  ) as moderation_colonnes,
  -- 0024 : type « envie », pièces envoyées, réglage, notifications, modération d'une pièce.
  exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
    where t.typname = 'post_type' and e.enumlabel = 'wish'
  ) as partage_type_envie,
  exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'piece_sends') as partage_table,
  (
    select count(*) = 3 from information_schema.columns
    where table_schema = 'public'
      and ((table_name = 'posts' and column_name = 'wishlist_item_id')
        or (table_name = 'profiles' and column_name = 'piece_sends_from')
        or (table_name = 'notifications' and column_name = 'piece_send_id'))
  ) as partage_colonnes,
  coalesce((select bool_and(pg_get_functiondef(p.oid) like '%piece_sends%') from pg_proc p where p.proname = 'moderation_set_hidden'), false) as partage_moderation,
  -- RLS active sur toutes les nouvelles tables.
  (
    select count(*) = 5 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relrowsecurity
      and c.relname in ('serpapi_calls', 'admins', 'moderation_actions', 'suspensions', 'piece_sends')
  ) as protection_active;
