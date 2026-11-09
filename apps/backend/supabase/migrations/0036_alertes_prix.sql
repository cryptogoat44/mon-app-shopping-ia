-- 0036 (lot 2 « alertes prix et stock », 2026-11-09) : prévenir un membre
-- quand une pièce de ses envies baisse de prix ou revient en stock dans la
-- même boutique, à partir des seules recherches et des seuls achats déjà
-- faits dans Spotto (aucune surveillance en tâche de fond, aucun appel payé).
--
-- Retour en arrière (après avoir remis un serveur qui ne connaît pas 0036 ;
-- les cloches, le suivi des pièces, les alertes et les signalements « Plus
-- disponible » sont alors perdus, les envies restent ; les appareils gardés
-- pour les seules alertes reçoivent de nouveau les messages, comme avant) :
--   drop function if exists wish_alerts_version();
--   drop function if exists wish_observe(jsonb, timestamptz);
--   drop function if exists wish_alerts_claim(integer, timestamptz);
--   drop function if exists wish_alerts_mark_sent(uuid[], timestamptz);
--   drop function if exists wish_alerts_release(uuid[]);
--   drop function if exists wish_stock_report(uuid, text, text, integer, timestamptz);
--   drop function if exists wish_alerts_purge(integer, timestamptz);
--   drop table if exists wish_alert_events, wish_watches, wish_tracking, stock_reports;
--   alter table profiles drop column if exists price_alerts_enabled;
--   alter table push_tokens drop column if exists notify_messages;
--
-- Ce qu'elle ajoute :
-- 1. wish_tracking : une ligne par envie (créée à chaque nouvelle envie, et
--    par le script de rattrapage pour les anciennes). L'empreinte SHA-256 de
--    la clé « même pièce » (jamais l'adresse elle-même ; NULL sans clé) et
--    sa version, le nom de la boutique normalisé, le prix de référence
--    (règle B : celui de la proposition d'origine, puis seulement le prix
--    d'une baisse vraiment envoyée), le dernier prix vu, le dernier état de
--    stock, et des dates au JOUR près. Jamais qui a cherché ni d'où vient
--    l'observation.
-- 2. wish_watches : la cloche d'une envie (baisse de prix, retour en stock,
--    épuisé — ce dernier caché dans l'app), et la date de la dernière alerte
--    envoyée de chaque sorte.
-- 3. wish_alert_events : les alertes, en attente (envoyées 2 à 8 h après,
--    au hasard, jamais par la demande qui les a créées), envoyées, expirées
--    (72 h), périmées, limitées (1 par envie et par sorte sur 7 jours, 5 par
--    personne et par jour de Paris) ou désactivées. Jamais l'auteur de la
--    recherche, l'acheteur, l'auteur d'un signalement, la proposition
--    observée ni son adresse. Effacées au bout de 30 jours.
--    « Limitée » est un état final : la référence ne bouge pas, donc la
--    même baisse revient à la prochaine observation et repasse par les limites.
-- 4. stock_reports : les signalements « Plus disponible » (le membre,
--    l'empreinte de la clé, le jour), pour la limite de 20 par jour et
--    l'export de ses données. Effacés au bout de 30 jours.
-- 5. profiles.price_alerts_enabled : l'interrupteur « Alertes prix et
--    stock » des Réglages, coupé par défaut.
-- 6. push_tokens.notify_messages : cet appareil reçoit-il les notifications
--    des messages ? (vrai par défaut : rien ne change pour les appareils déjà
--    enregistrés). Un appareil reste enregistré tant que les messages OU les
--    alertes sont allumés.
-- 7. Les fonctions du serveur (lui seul peut les appeler) : wish_observe
--    (une observation par lot, atomique), wish_alerts_claim (les alertes
--    dues, limites et expiration comprises), wish_alerts_mark_sent,
--    wish_alerts_release, wish_stock_report, wish_alerts_purge et
--    wish_alerts_version (sonde du serveur).
--
-- Demande 0035 (push_tokens) : refusée sans elle. Recrée au besoin la
-- contrainte (id, user_id) des envies (0033), sans effet sur les données.
-- Facultative pour le serveur : sans elle, aucune alerte n'est enregistrée ni
-- envoyée, et l'app cache la cloche, l'interrupteur et « Plus disponible »
-- (sonde wish_alerts_version, lib/wishAlerts.ts). À appliquer UNIQUEMENT sur
-- spotto-dev-2 (migrer-dev) tant que le fondateur ne décide pas autre chose.
-- Rejouable sans effet (if not exists, create or replace) ; ne supprime ni
-- ne modifie aucune donnée existante.
-- Aucune règle d'accès public : seul le serveur, avec sa clé secrète, lit et
-- écrit ces tables (RLS active, aucune politique).

do $$
begin
  if to_regclass('public.push_tokens') is null then
    raise exception '0036 demande la migration 0035 (push_tokens) : appliquez-la d''abord.';
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.wishlist_items'::regclass and conname = 'wishlist_items_id_user_id_key') then
    alter table wishlist_items add constraint wishlist_items_id_user_id_key unique (id, user_id);
  end if;
end;
$$;

-- ---- Interrupteur des Réglages, et appareils gardés pour les seules alertes ----
alter table profiles add column if not exists price_alerts_enabled boolean not null default false;
alter table push_tokens add column if not exists notify_messages boolean not null default true;

-- ---- Suivi d'une envie (une ligne par envie) ----
create table if not exists wish_tracking (
  wishlist_item_id uuid primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  match_key_hash text check (match_key_hash is null or match_key_hash ~ '^[0-9a-f]{64}$'),
  key_version smallint not null default 1 check (key_version >= 1),
  merchant_key text check (merchant_key is null or merchant_key ~ '^[a-z0-9]{1,80}$'),
  ref_price numeric(10,2) check (ref_price is null or ref_price > 0),
  ref_currency text check (ref_currency is null or ref_currency ~ '^[A-Z]{3}$'),
  ref_country text check (ref_country is null or ref_country ~ '^[a-z]{2}$'),
  ref_set_on date,
  last_price numeric(10,2) check (last_price is null or last_price > 0),
  last_currency text check (last_currency is null or last_currency ~ '^[A-Z]{3}$'),
  last_country text check (last_country is null or last_country ~ '^[a-z]{2}$'),
  last_seen_on date,
  stock_state text not null default 'unknown' check (stock_state in ('unknown', 'in_stock', 'sold_out')),
  stock_on date,
  updated_at timestamptz not null default now(),
  foreign key (wishlist_item_id, user_id) references wishlist_items (id, user_id) on delete cascade
);
-- Les envies d'une même pièce (une observation) ; jamais l'adresse.
create index if not exists wish_tracking_key_idx on wish_tracking (match_key_hash) where match_key_hash is not null;
create index if not exists wish_tracking_user_idx on wish_tracking (user_id);
alter table wish_tracking enable row level security;

-- ---- Cloche d'une envie ----
create table if not exists wish_watches (
  wishlist_item_id uuid primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  notify_price_drop boolean not null default false,
  notify_restock boolean not null default false,
  notify_sold_out boolean not null default false,
  last_sent_price_drop_at timestamptz,
  last_sent_restock_at timestamptz,
  last_sent_sold_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (wishlist_item_id, user_id) references wishlist_items (id, user_id) on delete cascade
);
create index if not exists wish_watches_user_idx on wish_watches (user_id);
alter table wish_watches enable row level security;

-- ---- Alertes ----
create table if not exists wish_alert_events (
  id uuid primary key default gen_random_uuid(),
  wishlist_item_id uuid not null,
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('price_drop', 'restock', 'sold_out')),
  old_price numeric(10,2) check (old_price is null or old_price > 0),
  new_price numeric(10,2) check (new_price is null or new_price > 0),
  currency text check (currency is null or currency ~ '^[A-Z]{3}$'),
  -- Le jour (heure de Paris) : la seule date montrée et exportée.
  created_on date not null,
  created_at timestamptz not null default now(),
  send_after timestamptz not null,
  -- Réservée par un envoi en cours (15 minutes au plus), sans être encore envoyée.
  claimed_at timestamptz,
  sent_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'sent', 'expired', 'stale', 'limited', 'disabled')),
  -- Un prix seulement pour une baisse, et toujours complet pour elle.
  check ((kind = 'price_drop') = (old_price is not null and new_price is not null and currency is not null)),
  check (kind <> 'price_drop' or new_price < old_price),
  foreign key (wishlist_item_id, user_id) references wishlist_items (id, user_id) on delete cascade
);
-- Au plus une alerte en attente par envie et par sorte.
create unique index if not exists wish_alert_events_one_pending_idx on wish_alert_events (wishlist_item_id, kind) where status = 'pending';
create index if not exists wish_alert_events_due_idx on wish_alert_events (send_after) where status = 'pending';
create index if not exists wish_alert_events_sent_idx on wish_alert_events (user_id, sent_at) where status = 'sent';
create index if not exists wish_alert_events_item_sent_idx on wish_alert_events (wishlist_item_id, kind, sent_at) where status = 'sent';
create index if not exists wish_alert_events_created_idx on wish_alert_events (created_at);
create index if not exists wish_alert_events_user_idx on wish_alert_events (user_id, created_on);
alter table wish_alert_events enable row level security;

-- ---- Signalements « Plus disponible » ----
create table if not exists stock_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  match_key_hash text not null check (match_key_hash ~ '^[0-9a-f]{64}$'),
  created_on date not null
);
create index if not exists stock_reports_user_day_idx on stock_reports (user_id, created_on);
create index if not exists stock_reports_created_idx on stock_reports (created_on);
alter table stock_reports enable row level security;

-- Le serveur seul : ni les visiteurs, ni les comptes connectés.
revoke all on table wish_tracking, wish_watches, wish_alert_events, stock_reports from public, anon, authenticated;
grant select, insert, update, delete on table wish_tracking, wish_watches, wish_alert_events, stock_reports to service_role;

-- ---- Sonde du serveur : la version du schéma des alertes ----
create or replace function wish_alerts_version()
returns integer
language plpgsql
stable
set search_path = public
as $$
begin
  return 1;
end;
$$;

-- ---- Une observation par lot (après la réponse d'une recherche, ou un achat) ----
-- p_batch : [{ k: empreinte, m: boutique normalisée|null, p: prix en
-- centimes|null, c: devise ISO|null, n: pays de la recherche|null,
-- s: stock annoncé true|false|null }], 200 au plus. Aucune personne : ni
-- l'auteur de la recherche, ni l'acheteur. Pour chaque envie de la même
-- pièce (même empreinte ; même boutique quand les deux en ont une), verrouillée :
-- - dernier prix, devise et pays (s'il y a un prix), jour vu, stock et son
--   jour : toujours mis à jour, cloche ou pas ;
-- - sans référence complète (prix, devise, pays) : la première observation
--   avec un prix la fixe, sans alerte ;
-- - baisse : même devise ET même pays que la référence, prix en centimes
--   inférieur, cloche « baisse » allumée, interrupteur allumé, pièce pas
--   achetée (Vault) → une alerte en attente (ou le nouveau prix d'une alerte
--   déjà en attente, s'il est plus bas). La référence ne bouge PAS ici ;
-- - retour en stock : stock « épuisé » puis disponibilité annoncée, cloche
--   « retour » allumée → une alerte ; épuisé annoncé (jamais par un
--   signalement d'un membre) avec la cloche « épuisé » → une alerte.
-- p_now : un instant fixé, pour les tests seulement.
create or replace function wish_observe(p_batch jsonb, p_now timestamptz default null)
returns table (matched integer, events integer)
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_today date := (coalesce(p_now, now()) at time zone 'Europe/Paris')::date;
  v_obs jsonb;
  v_key text;
  v_merchant text;
  v_amount numeric;
  v_cents bigint;
  v_currency text;
  v_country text;
  v_stock boolean;
  t record;
  v_alerts boolean;
  v_new_stock text;
  v_ref_price numeric(10,2);
  v_ref_currency text;
  v_ref_country text;
  v_ref_set_on date;
  v_rows integer;
  v_matched integer := 0;
  v_events integer := 0;
begin
  if p_batch is null or jsonb_typeof(p_batch) <> 'array' or jsonb_array_length(p_batch) > 200 then
    raise exception 'wish_observe : lot invalide';
  end if;
  -- Clés dans l'ordre (puis les envies dans l'ordre) : deux lots simultanés
  -- verrouillent les mêmes lignes dans le même ordre.
  for v_obs in select value from jsonb_array_elements(p_batch) order by value->>'k' loop
    v_key := v_obs->>'k';
    if v_key is null or v_key !~ '^[0-9a-f]{64}$' then
      continue;
    end if;
    v_merchant := case when coalesce(v_obs->>'m', '') ~ '^[a-z0-9]{1,80}$' then v_obs->>'m' end;
    v_currency := case when coalesce(v_obs->>'c', '') ~ '^[A-Z]{3}$' then v_obs->>'c' end;
    v_country := case when coalesce(v_obs->>'n', '') ~ '^[a-z]{2}$' then v_obs->>'n' end;
    v_stock := case when jsonb_typeof(v_obs->'s') = 'boolean' then (v_obs->>'s')::boolean end;
    v_cents := null;
    if jsonb_typeof(v_obs->'p') = 'number' then
      v_amount := (v_obs->>'p')::numeric;
      if v_amount = trunc(v_amount) and v_amount > 0 and v_amount <= 9999999999 and v_currency is not null and v_country is not null then
        v_cents := v_amount::bigint;
      end if;
    end if;

    for t in
      select tr.wishlist_item_id, tr.user_id, tr.stock_state, tr.stock_on,
             tr.ref_price, tr.ref_currency, tr.ref_country, tr.ref_set_on,
             coalesce(p.price_alerts_enabled, false) as alerts_enabled,
             coalesce(ww.notify_price_drop, false) as watch_price_drop,
             coalesce(ww.notify_restock, false) as watch_restock,
             coalesce(ww.notify_sold_out, false) as watch_sold_out,
             (w.product_match_id is not null and exists (
                select 1 from vault_items v where v.user_id = tr.user_id and v.product_match_id = w.product_match_id
             )) as bought
        from wish_tracking tr
        join wishlist_items w on w.id = tr.wishlist_item_id
        join profiles p on p.id = tr.user_id
        left join wish_watches ww on ww.wishlist_item_id = tr.wishlist_item_id
       where tr.match_key_hash = v_key
         and (tr.merchant_key is null or v_merchant is null or tr.merchant_key = v_merchant)
       order by tr.wishlist_item_id
       for update of tr
    loop
      v_matched := v_matched + 1;
      v_alerts := t.alerts_enabled and not t.bought;
      v_new_stock := t.stock_state;

      -- Stock : seulement une annonce explicite.
      if v_stock is true then
        if t.stock_state = 'sold_out' and v_alerts and t.watch_restock then
          insert into wish_alert_events (wishlist_item_id, user_id, kind, created_on, created_at, send_after)
          values (t.wishlist_item_id, t.user_id, 'restock', v_today, v_now, v_now + interval '2 hours' + random() * interval '6 hours')
          on conflict (wishlist_item_id, kind) where status = 'pending' do nothing;
          get diagnostics v_rows = row_count;
          v_events := v_events + v_rows;
        end if;
        v_new_stock := 'in_stock';
      elsif v_stock is false then
        if t.stock_state <> 'sold_out' and v_alerts and t.watch_sold_out then
          insert into wish_alert_events (wishlist_item_id, user_id, kind, created_on, created_at, send_after)
          values (t.wishlist_item_id, t.user_id, 'sold_out', v_today, v_now, v_now + interval '2 hours' + random() * interval '6 hours')
          on conflict (wishlist_item_id, kind) where status = 'pending' do nothing;
          get diagnostics v_rows = row_count;
          v_events := v_events + v_rows;
        end if;
        v_new_stock := 'sold_out';
      end if;

      -- Prix (règle B).
      v_ref_price := t.ref_price;
      v_ref_currency := t.ref_currency;
      v_ref_country := t.ref_country;
      v_ref_set_on := t.ref_set_on;
      if v_cents is not null then
        if t.ref_price is null or t.ref_currency is null or t.ref_country is null then
          v_ref_price := v_cents / 100.0;
          v_ref_currency := v_currency;
          v_ref_country := v_country;
          v_ref_set_on := v_today;
        elsif t.ref_currency = v_currency and t.ref_country = v_country
              and v_cents < round(t.ref_price * 100) and v_alerts and t.watch_price_drop then
          -- Une alerte déjà en attente (et pas en cours d'envoi) prend le prix le plus bas.
          update wish_alert_events e
             set new_price = least(e.new_price, v_cents / 100.0)
           where e.wishlist_item_id = t.wishlist_item_id and e.kind = 'price_drop' and e.status = 'pending'
             and (e.claimed_at is null or e.claimed_at < v_now - interval '15 minutes');
          if not found then
            insert into wish_alert_events (wishlist_item_id, user_id, kind, old_price, new_price, currency, created_on, created_at, send_after)
            values (t.wishlist_item_id, t.user_id, 'price_drop', t.ref_price, v_cents / 100.0, v_currency, v_today, v_now,
                    v_now + interval '2 hours' + random() * interval '6 hours')
            on conflict (wishlist_item_id, kind) where status = 'pending' do nothing;
            get diagnostics v_rows = row_count;
            v_events := v_events + v_rows;
          end if;
        end if;
      end if;

      update wish_tracking
         set last_price = case when v_cents is not null then v_cents / 100.0 else last_price end,
             last_currency = case when v_cents is not null then v_currency else last_currency end,
             last_country = case when v_cents is not null then v_country else last_country end,
             last_seen_on = v_today,
             stock_state = v_new_stock,
             stock_on = case when v_stock is not null then v_today else stock_on end,
             ref_price = v_ref_price,
             ref_currency = v_ref_currency,
             ref_country = v_ref_country,
             ref_set_on = v_ref_set_on,
             updated_at = v_now
       where wishlist_item_id = t.wishlist_item_id;
    end loop;
  end loop;
  return query select v_matched, v_events;
end;
$$;

-- ---- Les alertes à envoyer (une file, sans tâche de fond) ----
-- Dans l'ordre, sous un verrou commun (un seul envoi à la fois) :
-- 1. en attente depuis plus de 72 h → « expirée », jamais envoyée ;
-- 2. dues, mais interrupteur coupé ou cloche de cette sorte coupée → « désactivée » ;
-- 3. p_limit = 0 (notifications coupées sur le serveur) : rien d'autre, les
--    alertes restent en attente (elles expireront à 72 h) ;
-- 4. sinon, les alertes dues des membres qui ont un appareil (sans appareil :
--    elles restent en attente), les plus anciennes d'abord :
--    - revérifiées sur le dernier suivi : la pièce est achetée, ou le prix
--      n'est plus au plus celui de l'alerte (même devise, même pays), ou le
--      stock n'est plus celui annoncé → « périmée » ;
--    - limites, comptées sur les alertes ENVOYÉES (et celles en cours
--      d'envoi) : déjà une alerte de cette sorte pour cette envie sur 7 jours,
--      ou 5 pour la personne ce jour (heure de Paris) → « limitée » (la
--      référence ne bouge pas : la baisse reviendra) ;
--    - les autres sont réservées (claimed_at) et renvoyées, avec ce qu'il faut
--      pour le texte de la notification.
-- p_now : un instant fixé, pour les tests seulement ; seules les alertes
-- créées dans les 30 jours avant lui sont alors regardées (un test qui vit
-- dans une autre année ne touche jamais les alertes réelles de la base).
create or replace function wish_alerts_claim(p_limit integer, p_now timestamptz default null)
returns table (
  event_id uuid,
  user_id uuid,
  wishlist_item_id uuid,
  kind text,
  old_price numeric,
  new_price numeric,
  currency text,
  title text,
  merchant_name text,
  locale text
)
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_day_start timestamptz := date_trunc('day', coalesce(p_now, now()) at time zone 'Europe/Paris') at time zone 'Europe/Paris';
  v_since timestamptz := case when p_now is null then '-infinity'::timestamptz else p_now - interval '30 days' end;
  e record;
  v_status text;
begin
  if p_limit is null or p_limit < 0 or p_limit > 200 then
    raise exception 'wish_alerts_claim : limite invalide';
  end if;
  perform pg_advisory_xact_lock(hashtext('wish_alerts_claim'));

  update wish_alert_events ev
     set status = 'expired', claimed_at = null
   where ev.status = 'pending' and ev.created_at < v_now - interval '72 hours' and ev.created_at >= v_since;

  update wish_alert_events ev
     set status = 'disabled', claimed_at = null
   where ev.status = 'pending' and ev.send_after <= v_now and ev.created_at >= v_since
     and (ev.claimed_at is null or ev.claimed_at < v_now - interval '15 minutes')
     and not exists (
       select 1
         from profiles p
         join wish_watches w on w.user_id = p.id and w.wishlist_item_id = ev.wishlist_item_id
        where p.id = ev.user_id and p.price_alerts_enabled
          and case ev.kind when 'price_drop' then w.notify_price_drop when 'restock' then w.notify_restock else w.notify_sold_out end
     );

  if p_limit = 0 then
    return;
  end if;

  for e in
    select ev.id, ev.user_id as owner_id, ev.wishlist_item_id as item_id, ev.kind as alert_kind,
           ev.old_price as alert_old_price, ev.new_price as alert_new_price, ev.currency as alert_currency,
           tr.last_price, tr.last_currency, tr.last_country, tr.stock_state, tr.ref_price, tr.ref_currency, tr.ref_country,
           w.product_match_id, w.title as item_title, w.merchant_name as item_merchant, p.locale as owner_locale
      from wish_alert_events ev
      join wish_tracking tr on tr.wishlist_item_id = ev.wishlist_item_id
      join wishlist_items w on w.id = ev.wishlist_item_id
      join profiles p on p.id = ev.user_id
     where ev.status = 'pending' and ev.send_after <= v_now and ev.created_at >= v_since
       and (ev.claimed_at is null or ev.claimed_at < v_now - interval '15 minutes')
       and exists (select 1 from push_tokens pt where pt.user_id = ev.user_id)
     order by ev.send_after, ev.id
     limit p_limit
     for update of ev
  loop
    v_status := null;
    if e.product_match_id is not null
       and exists (select 1 from vault_items v where v.user_id = e.owner_id and v.product_match_id = e.product_match_id) then
      v_status := 'stale';
    elsif e.alert_kind = 'price_drop' and not (
            e.last_price is not null and e.last_currency = e.alert_currency and e.last_country = e.ref_country
            and round(e.last_price * 100) <= round(e.alert_new_price * 100)
            and e.ref_currency = e.alert_currency and round(e.alert_new_price * 100) < round(e.ref_price * 100)) then
      v_status := 'stale';
    elsif e.alert_kind = 'restock' and e.stock_state <> 'in_stock' then
      v_status := 'stale';
    elsif e.alert_kind = 'sold_out' and e.stock_state <> 'sold_out' then
      v_status := 'stale';
    elsif exists (
            select 1 from wish_alert_events s
             where s.wishlist_item_id = e.item_id and s.kind = e.alert_kind and s.status = 'sent'
               and s.sent_at > v_now - interval '7 days') then
      v_status := 'limited';
    elsif (select count(*) from wish_alert_events s
            where s.user_id = e.owner_id and s.id <> e.id
              and ((s.status = 'sent' and s.sent_at >= v_day_start)
                   or (s.status = 'pending' and s.claimed_at >= greatest(v_day_start, v_now - interval '15 minutes')))) >= 5 then
      v_status := 'limited';
    end if;

    if v_status is not null then
      update wish_alert_events set status = v_status, claimed_at = null where id = e.id;
    else
      update wish_alert_events set claimed_at = v_now where id = e.id;
      event_id := e.id;
      user_id := e.owner_id;
      wishlist_item_id := e.item_id;
      kind := e.alert_kind;
      old_price := e.alert_old_price;
      new_price := e.alert_new_price;
      currency := e.alert_currency;
      title := e.item_title;
      merchant_name := e.item_merchant;
      locale := e.owner_locale;
      return next;
    end if;
  end loop;
end;
$$;

-- ---- Alertes envoyées : « envoyée », et la référence d'une baisse bouge (règle B) ----
create or replace function wish_alerts_mark_sent(p_ids uuid[], p_now timestamptz default null)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_today date := (coalesce(p_now, now()) at time zone 'Europe/Paris')::date;
  e record;
  v_count integer := 0;
begin
  if p_ids is null or cardinality(p_ids) > 200 then
    raise exception 'wish_alerts_mark_sent : liste invalide';
  end if;
  for e in
    select ev.id, ev.wishlist_item_id, ev.kind, ev.new_price, ev.currency
      from wish_alert_events ev
     where ev.id = any(p_ids) and ev.status = 'pending' and ev.claimed_at is not null
     order by ev.wishlist_item_id
     for update
  loop
    update wish_alert_events set status = 'sent', sent_at = v_now, claimed_at = null where id = e.id;
    if e.kind = 'price_drop' then
      update wish_tracking
         set ref_price = e.new_price, ref_currency = e.currency, ref_set_on = v_today, updated_at = v_now
       where wishlist_item_id = e.wishlist_item_id;
      update wish_watches set last_sent_price_drop_at = v_now where wishlist_item_id = e.wishlist_item_id;
    elsif e.kind = 'restock' then
      update wish_watches set last_sent_restock_at = v_now where wishlist_item_id = e.wishlist_item_id;
    else
      update wish_watches set last_sent_sold_out_at = v_now where wishlist_item_id = e.wishlist_item_id;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---- Envoi impossible : les alertes réservées redeviennent disponibles ----
create or replace function wish_alerts_release(p_ids uuid[])
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_ids is null or cardinality(p_ids) > 200 then
    raise exception 'wish_alerts_release : liste invalide';
  end if;
  update wish_alert_events set claimed_at = null where id = any(p_ids) and status = 'pending';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---- « Plus disponible » : signalement d'un membre ----
-- Limite de p_daily_cap par membre et par jour (heure de Paris), sous un
-- verrou par membre. Le signalement est gardé (le membre, l'empreinte, le
-- jour) ; puis toutes les envies de la même pièce passent « épuisée » ce
-- jour-là, SANS AUCUNE alerte (une disponibilité annoncée plus tard
-- déclenchera le retour en stock). Le membre n'est jamais lié au suivi.
create or replace function wish_stock_report(p_user_id uuid, p_key text, p_merchant text, p_daily_cap integer, p_now timestamptz default null)
returns table (allowed boolean, matched integer)
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_today date := (coalesce(p_now, now()) at time zone 'Europe/Paris')::date;
  v_merchant text := case when coalesce(p_merchant, '') ~ '^[a-z0-9]{1,80}$' then p_merchant end;
  v_count integer;
  v_matched integer;
begin
  if p_user_id is null or p_key is null or p_key !~ '^[0-9a-f]{64}$' or p_daily_cap is null or p_daily_cap < 1 then
    raise exception 'wish_stock_report : paramètres invalides';
  end if;
  perform pg_advisory_xact_lock(hashtext('wish_stock_report:' || p_user_id::text));
  select count(*) into v_count from stock_reports r where r.user_id = p_user_id and r.created_on = v_today;
  if v_count >= p_daily_cap then
    return query select false, 0;
    return;
  end if;
  insert into stock_reports (user_id, match_key_hash, created_on) values (p_user_id, p_key, v_today);
  update wish_tracking tr
     set stock_state = 'sold_out', stock_on = v_today, updated_at = v_now
   where tr.wishlist_item_id in (
           select t.wishlist_item_id from wish_tracking t
            where t.match_key_hash = p_key
              and (t.merchant_key is null or v_merchant is null or t.merchant_key = v_merchant)
            order by t.wishlist_item_id
            for update);
  get diagnostics v_matched = row_count;
  return query select true, v_matched;
end;
$$;

-- ---- Effacement des alertes et des signalements de plus de 30 jours ----
-- Borné (p_limit lignes de chaque table au plus par appel) ; appelée par le
-- serveur à côté de la purge du cache des recherches. p_now : un instant
-- fixé, pour les tests seulement ; seules les lignes des 2 années avant lui
-- sont alors effacées (jamais les lignes réelles de la base).
create or replace function wish_alerts_purge(p_limit integer, p_now timestamptz default null)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_since timestamptz := case when p_now is null then '-infinity'::timestamptz else p_now - interval '2 years' end;
  v_events integer;
  v_reports integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'wish_alerts_purge : limite invalide';
  end if;
  delete from wish_alert_events
   where id in (select id from wish_alert_events where created_at < v_now - interval '30 days' and created_at >= v_since limit p_limit);
  get diagnostics v_events = row_count;
  delete from stock_reports
   where id in (select id from stock_reports
                 where created_on < (v_now at time zone 'Europe/Paris')::date - 30
                   and created_on >= (v_since at time zone 'Europe/Paris')::date limit p_limit);
  get diagnostics v_reports = row_count;
  return v_events + v_reports;
end;
$$;

revoke all on function wish_alerts_version() from public, anon, authenticated;
grant execute on function wish_alerts_version() to service_role;
revoke all on function wish_observe(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function wish_observe(jsonb, timestamptz) to service_role;
revoke all on function wish_alerts_claim(integer, timestamptz) from public, anon, authenticated;
grant execute on function wish_alerts_claim(integer, timestamptz) to service_role;
revoke all on function wish_alerts_mark_sent(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function wish_alerts_mark_sent(uuid[], timestamptz) to service_role;
revoke all on function wish_alerts_release(uuid[]) from public, anon, authenticated;
grant execute on function wish_alerts_release(uuid[]) to service_role;
revoke all on function wish_stock_report(uuid, text, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function wish_stock_report(uuid, text, text, integer, timestamptz) to service_role;
revoke all on function wish_alerts_purge(integer, timestamptz) from public, anon, authenticated;
grant execute on function wish_alerts_purge(integer, timestamptz) to service_role;

notify pgrst, 'reload schema';
