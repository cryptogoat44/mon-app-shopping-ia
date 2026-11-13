-- 0040 (lot « durcissement des alertes », 2026-11-13) : les garde-fous des
-- alertes prix et stock (0036), demandés par la revue de sécurité avant toute
-- mise en production. Règle d'ensemble : un membre seul ne change jamais ce
-- que reçoivent les autres membres.
--
-- Retour en arrière, dans cet ordre. Le serveur actuel coupe alors les
-- alertes de lui-même (sonde à 1 : « garde-fous absents » dans son journal) ;
-- un serveur d'avant 0040 les rallume, SANS ces garde-fous.
-- 1. retirer les deux règles (les fonctions de 0036 ne connaissent pas l'origine) :
--   alter table wish_tracking drop constraint if exists wish_tracking_sold_out_source_check;
--   alter table wish_tracking drop constraint if exists wish_tracking_member_country_check;
-- 2. rejouer le fichier 0036_alertes_prix.sql en entier (rejouable sans
--    effet : il remet les fonctions d'origine et la sonde à 1) ;
-- 3. puis :
--   drop function if exists wish_mark_bought(uuid, text, text, boolean, timestamptz);
--   alter table wish_tracking drop column if exists sold_out_source;
--   alter table wish_tracking drop column if exists member_country;
--   alter table wish_tracking drop column if exists bought_on;
--   drop index if exists stock_reports_key_day_idx;
-- Ce qui est perdu : d'où vient chaque « épuisée », le pays de chaque membre
-- sur ses envies et les pièces achetées depuis un autre résultat (la règle
-- « même proposition » de 0036 reprend seule).
--
-- Ce qu'elle change :
-- 1. « Plus disponible » (wish_stock_report) : un signalement ne touche les
--    envies des AUTRES membres qu'une fois la même pièce (même empreinte)
--    signalée par au moins 2 membres différents dans les 30 derniers jours
--    (les signalements sont gardés 30 jours, 0036). Avec un seul auteur,
--    seules ses propres envies passent « épuisée ».
-- 2. wish_tracking.sold_out_source : d'où vient l'état « épuisée » — 'shop'
--    (la boutique l'annonce : observation avec s = false) ou 'members'
--    (signalements). Un « en stock » observé après un « épuisée » venu des
--    membres remet l'état sans bruit : AUCUNE alerte « retour en stock ».
--    Le retour en stock n'est annoncé qu'après un « épuisé » annoncé par la
--    boutique. Les baisses de prix ne sont bloquées que par un « épuisé »
--    annoncé par la boutique (jamais par des signalements). Les envies déjà
--    « épuisée » avant 0040 (origine inconnue) sont notées 'members' : dans
--    le doute, aucune alerte.
-- 3. wish_observe : une seule envie par membre et par pièce est regardée
--    (celle dont la cloche est allumée d'abord, puis la plus ancienne par
--    identifiant) ; une ligne de suivi n'est réécrite que si le prix, le
--    stock, son origine, la référence ou le jour d'observation changent
--    vraiment (le plafond de 1 000 envies par membre est tenu par le serveur).
-- 4. wish_tracking.member_country : le pays du membre (sa recherche, à la
--    création de l'envie). La référence n'est fixée et comparée qu'avec les
--    observations de ce pays ; une observation d'un autre pays ne touche pas
--    au prix. Une envie d'avant 0040 (sans pays) prend, comme avant, le pays
--    de sa première observation avec un prix (celui de sa référence).
-- 5. wish_tracking.bought_on : « Je l'ai achetée » sur une proposition marque
--    achetées TOUTES les envies du membre de la même pièce (même empreinte,
--    même boutique quand les deux en ont une), pas seulement celle de la même
--    proposition ; wish_observe et wish_alerts_claim n'alertent jamais pour
--    elles (wish_mark_bought, appelée par le serveur avant l'observation de
--    l'achat ; retirer la pièce du Vault rend les alertes si aucune autre
--    pièce du Vault n'a la même empreinte). La règle « même proposition » de
--    0036 reste vraie aussi.
-- 6. wish_alerts_version répond 2 : le serveur n'allume les alertes qu'avec
--    ces garde-fous (avec 0036 seule, il les coupe et le dit dans son journal).
--
-- Demande 0036 : refusée sans elle. Aucun déclencheur : rien n'écrit dans une
-- autre table pendant la suppression d'un compte (les cascades de 0036 suffisent).
-- À appliquer UNIQUEMENT sur spotto-dev-2 (migrer-dev) tant que le fondateur
-- ne décide pas autre chose, et toujours avec ou après 0036.
-- Rejouable sans effet (if not exists, create or replace) ; ne supprime
-- aucune donnée. Seul le serveur, avec sa clé secrète, appelle ces fonctions.

do $$
begin
  if to_regclass('public.wish_tracking') is null or to_regclass('public.stock_reports') is null
     or to_regprocedure('public.wish_alerts_version()') is null then
    raise exception '0040 demande la migration 0036 (alertes prix et stock) : appliquez-la d''abord.';
  end if;
end;
$$;

-- ---- Suivi : d'où vient « épuisée », le pays du membre, l'achat ----
alter table wish_tracking add column if not exists sold_out_source text;
alter table wish_tracking add column if not exists member_country text;
alter table wish_tracking add column if not exists bought_on date;

-- Pays du membre pour les suivis déjà là : en français, la recherche se fait
-- toujours en France ; en anglais, la région n'est pas connue (aucun pays).
update wish_tracking t set member_country = 'fr'
  from profiles p
  where p.id = t.user_id and p.locale = 'fr' and t.member_country is null;

-- Origine inconnue (avant 0040) : comme un signalement (aucune alerte « retour en stock »).
update wish_tracking set sold_out_source = 'members' where stock_state = 'sold_out' and sold_out_source is null;
update wish_tracking set sold_out_source = null where stock_state <> 'sold_out' and sold_out_source is not null;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.wish_tracking'::regclass and conname = 'wish_tracking_sold_out_source_check') then
    -- Une origine pour chaque « épuisée », et seulement pour lui.
    alter table wish_tracking add constraint wish_tracking_sold_out_source_check
      check ((sold_out_source is null or sold_out_source in ('shop', 'members'))
             and ((stock_state = 'sold_out') = (sold_out_source is not null)));
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.wish_tracking'::regclass and conname = 'wish_tracking_member_country_check') then
    alter table wish_tracking add constraint wish_tracking_member_country_check
      check (member_country is null or member_country ~ '^[a-z]{2}$');
  end if;
end;
$$;

-- Les auteurs différents d'une même pièce sur 30 jours.
create index if not exists stock_reports_key_day_idx on stock_reports (match_key_hash, created_on);

-- ---- Sonde du serveur : 2 = garde-fous présents ----
create or replace function wish_alerts_version()
returns integer
language plpgsql
stable
set search_path = public
as $$
begin
  return 2;
end;
$$;

-- ---- Une observation par lot (après la réponse d'une recherche, ou un achat) ----
-- Même lot qu'en 0036 (k, m, p, c, n, s ; 200 au plus ; jamais une personne).
-- Pour chaque pièce, une seule envie par membre (cloche allumée d'abord, puis
-- l'identifiant le plus petit), verrouillée :
-- - stock : seulement une annonce explicite. s = true après un « épuisé »
--   annoncé par la boutique (sold_out_source = 'shop') → alerte « retour en
--   stock » (cloche allumée) ; après un « épuisée » venu des membres : l'état
--   change, sans alerte. s = false → « épuisée », origine 'shop' (alerte
--   « épuisé » si la pièce ne l'était pas, cloche allumée) ;
-- - prix : seulement une observation du pays du membre (member_country ;
--   sans lui, celui de la référence) ; sans référence complète, la première
--   la fixe, sans alerte ; baisse dans la même devise et le même pays,
--   cloche « baisse » et interrupteur allumés, pièce pas achetée, pas
--   « épuisée » annoncée par la boutique → une alerte (ou le prix plus bas
--   d'une alerte déjà en attente). La référence ne bouge pas ici ;
-- - pièce achetée (bought_on, ou même proposition dans le Vault) : aucune alerte ;
-- - la ligne n'est réécrite que si quelque chose change.
-- Verrou partagé « wish_alerts » d'abord, puis les suivis : empreintes dans
-- l'ordre, envies dans l'ordre. p_now : un instant fixé, pour les tests seulement.
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
  v_ids uuid[];
  t record;
  v_alerts boolean;
  v_new_stock text;
  v_new_source text;
  v_new_stock_on date;
  v_row_country text;
  v_last_price numeric(10,2);
  v_last_currency text;
  v_last_country text;
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
  perform pg_advisory_xact_lock_shared(hashtext('wish_alerts'));
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

    -- Une seule envie par membre pour cette pièce (lecture sans verrou ; revérifiée ci-dessous).
    select coalesce(array_agg(c.id order by c.id), '{}'::uuid[]) into v_ids
      from (select distinct on (tr.user_id) tr.wishlist_item_id as id
              from wish_tracking tr
              left join wish_watches ww on ww.wishlist_item_id = tr.wishlist_item_id
             where tr.match_key_hash = v_key
               and (tr.merchant_key is null or v_merchant is null or tr.merchant_key = v_merchant)
             order by tr.user_id,
                      (coalesce(ww.notify_price_drop, false) or coalesce(ww.notify_restock, false) or coalesce(ww.notify_sold_out, false)) desc,
                      tr.wishlist_item_id) c;

    for t in
      select tr.wishlist_item_id, tr.user_id, tr.stock_state, tr.stock_on, tr.sold_out_source, tr.member_country,
             tr.last_price, tr.last_currency, tr.last_country,
             tr.ref_price, tr.ref_currency, tr.ref_country, tr.ref_set_on,
             coalesce(p.price_alerts_enabled, false) as alerts_enabled,
             coalesce(ww.notify_price_drop, false) as watch_price_drop,
             coalesce(ww.notify_restock, false) as watch_restock,
             coalesce(ww.notify_sold_out, false) as watch_sold_out,
             (tr.bought_on is not null or (w.product_match_id is not null and exists (
                select 1 from vault_items v where v.user_id = tr.user_id and v.product_match_id = w.product_match_id
             ))) as bought
        from wish_tracking tr
        join wishlist_items w on w.id = tr.wishlist_item_id
        join profiles p on p.id = tr.user_id
        left join wish_watches ww on ww.wishlist_item_id = tr.wishlist_item_id
       where tr.wishlist_item_id = any(v_ids)
         and tr.match_key_hash = v_key
       order by tr.wishlist_item_id
       for update of tr
    loop
      v_matched := v_matched + 1;
      v_alerts := t.alerts_enabled and not t.bought;
      v_new_stock := t.stock_state;
      v_new_source := t.sold_out_source;
      v_new_stock_on := t.stock_on;

      -- Stock : seulement une annonce explicite.
      if v_stock is true then
        -- « De retour en stock » seulement après un « épuisé » annoncé par la boutique.
        if t.stock_state = 'sold_out' and t.sold_out_source = 'shop' and v_alerts and t.watch_restock then
          insert into wish_alert_events (wishlist_item_id, user_id, kind, created_on, created_at, send_after)
          values (t.wishlist_item_id, t.user_id, 'restock', v_today, v_now, v_now)
          on conflict (wishlist_item_id, kind) where status = 'pending' do nothing;
          get diagnostics v_rows = row_count;
          v_events := v_events + v_rows;
        end if;
        v_new_stock := 'in_stock';
        v_new_source := null;
        v_new_stock_on := v_today;
      elsif v_stock is false then
        if t.stock_state <> 'sold_out' and v_alerts and t.watch_sold_out then
          insert into wish_alert_events (wishlist_item_id, user_id, kind, created_on, created_at, send_after)
          values (t.wishlist_item_id, t.user_id, 'sold_out', v_today, v_now, v_now)
          on conflict (wishlist_item_id, kind) where status = 'pending' do nothing;
          get diagnostics v_rows = row_count;
          v_events := v_events + v_rows;
        end if;
        v_new_stock := 'sold_out';
        v_new_source := 'shop';
        v_new_stock_on := v_today;
      end if;

      -- Prix (règle B), seulement une observation du pays du membre.
      v_last_price := t.last_price;
      v_last_currency := t.last_currency;
      v_last_country := t.last_country;
      v_ref_price := t.ref_price;
      v_ref_currency := t.ref_currency;
      v_ref_country := t.ref_country;
      v_ref_set_on := t.ref_set_on;
      v_row_country := coalesce(t.member_country, t.ref_country);
      if v_cents is not null and (v_row_country is null or v_country = v_row_country) then
        v_last_price := v_cents / 100.0;
        v_last_currency := v_currency;
        v_last_country := v_country;
        if t.ref_price is null or t.ref_currency is null or t.ref_country is null then
          v_ref_price := v_cents / 100.0;
          v_ref_currency := v_currency;
          v_ref_country := v_country;
          v_ref_set_on := v_today;
        elsif t.ref_currency = v_currency and t.ref_country = v_country
              and v_cents < round(t.ref_price * 100) and v_alerts and t.watch_price_drop
              and not (v_new_stock = 'sold_out' and v_new_source = 'shop') then
          -- Une alerte déjà en attente (et pas en cours d'envoi) prend le prix le plus bas.
          update wish_alert_events e
             set new_price = least(e.new_price, v_cents / 100.0)
           where e.wishlist_item_id = t.wishlist_item_id and e.kind = 'price_drop' and e.status = 'pending'
             and e.pushing_at is null
             and (e.claimed_at is null or e.claimed_at < v_now - interval '15 minutes');
          if not found then
            insert into wish_alert_events (wishlist_item_id, user_id, kind, old_price, new_price, currency, created_on, created_at, send_after)
            values (t.wishlist_item_id, t.user_id, 'price_drop', t.ref_price, v_cents / 100.0, v_currency, v_today, v_now, v_now)
            on conflict (wishlist_item_id, kind) where status = 'pending' do nothing;
            get diagnostics v_rows = row_count;
            v_events := v_events + v_rows;
          end if;
        end if;
      end if;

      -- Réécrite seulement si quelque chose change (updated_at ne bouge jamais :
      -- le suivi ne garde que des jours).
      update wish_tracking tr
         set last_price = v_last_price,
             last_currency = v_last_currency,
             last_country = v_last_country,
             last_seen_on = v_today,
             stock_state = v_new_stock,
             sold_out_source = v_new_source,
             stock_on = v_new_stock_on,
             ref_price = v_ref_price,
             ref_currency = v_ref_currency,
             ref_country = v_ref_country,
             ref_set_on = v_ref_set_on
       where tr.wishlist_item_id = t.wishlist_item_id
         and (tr.last_price, tr.last_currency, tr.last_country, tr.last_seen_on, tr.stock_state, tr.sold_out_source,
              tr.stock_on, tr.ref_price, tr.ref_currency, tr.ref_country, tr.ref_set_on)
             is distinct from
             (v_last_price, v_last_currency, v_last_country, v_today, v_new_stock, v_new_source,
              v_new_stock_on, v_ref_price, v_ref_currency, v_ref_country, v_ref_set_on);
    end loop;
  end loop;
  return query select v_matched, v_events;
end;
$$;

-- ---- Les alertes à envoyer : comme 0036, avec les garde-fous ----
-- Seuls changements : une pièce achetée se reconnaît aussi à bought_on (même
-- pièce achetée depuis un autre résultat) ; une baisse n'est périmée par le
-- stock que si la boutique a annoncé « épuisé » (jamais par des signalements).
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
  v_next_day timestamptz := (date_trunc('day', coalesce(p_now, now()) at time zone 'Europe/Paris') + interval '1 day') at time zone 'Europe/Paris';
  v_since timestamptz := case when p_now is null then '-infinity'::timestamptz else p_now - interval '30 days' end;
  v_lease timestamptz := coalesce(p_now, now()) - interval '15 minutes';
  e record;
  v_status text;
  v_last_sent timestamptz;
  v_wait_until timestamptz;
begin
  if p_limit is null or p_limit < 0 or p_limit > 200 then
    raise exception 'wish_alerts_claim : limite invalide';
  end if;
  perform pg_advisory_xact_lock(hashtext('wish_alerts'));

  -- 0. Envoi peut-être reçu, jamais noté : « envoyée » (référence d'une baisse comprise).
  perform wish_alerts_mark_sent(array(
    select ev.id from wish_alert_events ev
     where ev.status = 'pending' and ev.pushing_at is not null and ev.claimed_at < v_lease and ev.created_at >= v_since
     order by ev.id
     limit 200), v_now);

  -- 1. Expirées (jamais une alerte dont l'envoi est en cours ailleurs).
  update wish_alert_events ev
     set status = 'expired', claimed_at = null
   where ev.status = 'pending' and ev.created_at < v_now - interval '72 hours' and ev.created_at >= v_since
     and ev.pushing_at is null
     and (ev.claimed_at is null or ev.claimed_at < v_lease);

  -- 2. Désactivées.
  update wish_alert_events ev
     set status = 'disabled', claimed_at = null
   where ev.status = 'pending' and ev.send_after <= v_now and ev.created_at >= v_since
     and ev.pushing_at is null
     and (ev.claimed_at is null or ev.claimed_at < v_lease)
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
           ev.created_at as alert_created_at,
           tr.last_price, tr.last_currency, tr.last_country, tr.stock_state, tr.sold_out_source, tr.bought_on,
           tr.ref_price, tr.ref_currency, tr.ref_country,
           w.product_match_id, w.title as item_title, w.merchant_name as item_merchant, p.locale as owner_locale
      from wish_alert_events ev
      join wish_tracking tr on tr.wishlist_item_id = ev.wishlist_item_id
      join wishlist_items w on w.id = ev.wishlist_item_id
      join profiles p on p.id = ev.user_id
     where ev.status = 'pending' and ev.send_after <= v_now and ev.created_at >= v_since
       and ev.pushing_at is null
       and (ev.claimed_at is null or ev.claimed_at < v_lease)
       and exists (select 1 from push_tokens pt where pt.user_id = ev.user_id and pt.notify_alerts)
     order by ev.send_after, ev.id
     limit p_limit
     for update of ev
  loop
    v_status := null;
    v_wait_until := null;
    if e.bought_on is not null
       or (e.product_match_id is not null
           and exists (select 1 from vault_items v where v.user_id = e.owner_id and v.product_match_id = e.product_match_id)) then
      v_status := 'stale';
    elsif e.alert_kind = 'price_drop' and not (
            e.last_price is not null and e.last_currency = e.alert_currency and e.last_country = e.ref_country
            and round(e.last_price * 100) <= round(e.alert_new_price * 100)
            and e.ref_currency = e.alert_currency and round(e.alert_new_price * 100) < round(e.ref_price * 100)
            and not (e.stock_state = 'sold_out' and e.sold_out_source = 'shop')) then
      v_status := 'stale';
    elsif e.alert_kind = 'restock' and e.stock_state <> 'in_stock' then
      v_status := 'stale';
    elsif e.alert_kind = 'sold_out' and e.stock_state <> 'sold_out' then
      v_status := 'stale';
    else
      select max(s.sent_at) into v_last_sent from wish_alert_events s
       where s.wishlist_item_id = e.item_id and s.kind = e.alert_kind and s.status = 'sent'
         and s.sent_at > v_now - interval '7 days';
      if v_last_sent is not null then
        v_wait_until := v_last_sent + interval '7 days';
      end if;
      if (select count(*) from wish_alert_events s
            where s.user_id = e.owner_id and s.id <> e.id
              and ((s.status = 'sent' and s.sent_at >= v_day_start)
                   or (s.status = 'pending' and s.claimed_at >= greatest(v_day_start, v_lease)))) >= 5 then
        v_wait_until := greatest(coalesce(v_wait_until, v_next_day), v_next_day);
      end if;
      if v_wait_until is not null then
        v_status := case when v_wait_until <= e.alert_created_at + interval '72 hours' then 'held' else 'limited' end;
      end if;
    end if;

    if v_status = 'held' then
      -- Elle attend le premier instant permis, et sera revérifiée alors.
      update wish_alert_events set send_after = v_wait_until, claimed_at = null where id = e.id;
    elsif v_status is not null then
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

-- ---- « Plus disponible » : signalement d'un membre ----
-- Comme 0036 (limite de p_daily_cap par membre et par jour de Paris, sous un
-- verrou par membre ; le signalement est gardé ; aucune alerte), sauf :
-- - avec un seul auteur (sur 30 jours) pour cette pièce, seules SES envies
--   passent « épuisée » ; dès 2 auteurs différents, celles de tous les membres ;
-- - l'origine notée est 'members' (un « épuisé » annoncé par la boutique le reste) ;
-- - une envie déjà « épuisée » ce jour-là n'est pas réécrite.
-- matched : les envies réécrites. Verrou partagé « wish_alerts », comme une observation.
create or replace function wish_stock_report(p_user_id uuid, p_key text, p_merchant text, p_daily_cap integer, p_now timestamptz default null)
returns table (allowed boolean, matched integer)
language plpgsql
set search_path = public
as $$
declare
  v_today date := (coalesce(p_now, now()) at time zone 'Europe/Paris')::date;
  v_merchant text := case when coalesce(p_merchant, '') ~ '^[a-z0-9]{1,80}$' then p_merchant end;
  v_count integer;
  v_reporters integer;
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
  perform pg_advisory_xact_lock_shared(hashtext('wish_alerts'));
  insert into stock_reports (user_id, match_key_hash, created_on) values (p_user_id, p_key, v_today);
  -- Auteurs différents de cette pièce sur 30 jours (durée de garde des signalements).
  select count(distinct r.user_id) into v_reporters
    from stock_reports r
   where r.match_key_hash = p_key and r.created_on >= v_today - 30;
  -- updated_at ne bouge pas : le suivi ne garde que des jours.
  update wish_tracking tr
     set stock_state = 'sold_out',
         stock_on = v_today,
         sold_out_source = case when tr.stock_state = 'sold_out' and tr.sold_out_source = 'shop' then 'shop' else 'members' end
   where tr.wishlist_item_id in (
           select t.wishlist_item_id from wish_tracking t
            where t.match_key_hash = p_key
              and (t.merchant_key is null or v_merchant is null or t.merchant_key = v_merchant)
              and (v_reporters >= 2 or t.user_id = p_user_id)
              and (t.stock_state <> 'sold_out' or t.stock_on is distinct from v_today)
            order by t.wishlist_item_id
            for update);
  get diagnostics v_matched = row_count;
  return query select true, v_matched;
end;
$$;

-- ---- « Je l'ai achetée » : toutes les envies du membre de la même pièce ----
-- p_bought = true : achetées (bought_on = le jour, déjà achetées : inchangées) ;
-- false : la pièce a quitté le Vault (le serveur vérifie avant qu'aucune
-- autre pièce de son Vault n'a la même empreinte). Seulement les envies de
-- p_user_id, de cette empreinte (même boutique quand les deux en ont une).
-- Renvoie le nombre d'envies changées. Verrou partagé « wish_alerts », puis
-- les suivis dans l'ordre, comme une observation.
create or replace function wish_mark_bought(p_user_id uuid, p_key text, p_merchant text, p_bought boolean, p_now timestamptz default null)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_today date := (coalesce(p_now, now()) at time zone 'Europe/Paris')::date;
  v_merchant text := case when coalesce(p_merchant, '') ~ '^[a-z0-9]{1,80}$' then p_merchant end;
  v_count integer;
begin
  if p_user_id is null or p_key is null or p_key !~ '^[0-9a-f]{64}$' or p_bought is null then
    raise exception 'wish_mark_bought : paramètres invalides';
  end if;
  perform pg_advisory_xact_lock_shared(hashtext('wish_alerts'));
  update wish_tracking tr
     set bought_on = case when p_bought then v_today else null end
   where tr.wishlist_item_id in (
           select t.wishlist_item_id from wish_tracking t
            where t.user_id = p_user_id
              and t.match_key_hash = p_key
              and (t.merchant_key is null or v_merchant is null or t.merchant_key = v_merchant)
              and (t.bought_on is null) = p_bought
            order by t.wishlist_item_id
            for update);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function wish_alerts_version() from public, anon, authenticated;
grant execute on function wish_alerts_version() to service_role;
revoke all on function wish_observe(jsonb, timestamptz) from public, anon, authenticated;
grant execute on function wish_observe(jsonb, timestamptz) to service_role;
revoke all on function wish_alerts_claim(integer, timestamptz) from public, anon, authenticated;
grant execute on function wish_alerts_claim(integer, timestamptz) to service_role;
revoke all on function wish_stock_report(uuid, text, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function wish_stock_report(uuid, text, text, integer, timestamptz) to service_role;
revoke all on function wish_mark_bought(uuid, text, text, boolean, timestamptz) from public, anon, authenticated;
grant execute on function wish_mark_bought(uuid, text, text, boolean, timestamptz) to service_role;

notify pgrst, 'reload schema';
