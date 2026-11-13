-- 0041 (lot « alertes, nouvelle version », 2026-11-13) : les règles des
-- alertes prix et stock décidées par le fondateur avant toute mise en
-- production (0036 et 0040 ne sont appliquées que sur spotto-dev-2).
--
-- Retour en arrière, dans cet ordre. Le serveur actuel coupe alors les
-- alertes de lui-même (sonde à 2 : « version 0041 absente » dans son journal) ;
-- un serveur d'avant 0041 les rallume, avec les règles de 0040.
-- 1. retirer les règles et les fonctions de 0041, remettre les colonnes
--    retirées (vides : la première observation refixe chaque référence) :
--   drop function if exists wish_observe(jsonb, uuid, timestamptz);
--   drop function if exists wish_alerts_claim(integer, timestamptz);
--   alter table wish_tracking drop constraint if exists wish_tracking_sold_out_source_check;
--   update wish_tracking set sold_out_source = 'members' where sold_out_source = 'reported';
--   alter table wish_alert_events drop constraint if exists wish_alert_events_sent_on_check;
--   alter table wish_alert_events drop constraint if exists wish_alert_events_lease_cleared_check;
--   alter table wish_watches drop constraint if exists wish_watches_target_check;
--   alter table wish_tracking add column if not exists ref_price numeric(10,2) check (ref_price is null or ref_price > 0),
--     add column if not exists ref_currency text check (ref_currency is null or ref_currency ~ '^[A-Z]{3}$'),
--     add column if not exists ref_country text check (ref_country is null or ref_country ~ '^[a-z]{2}$'),
--     add column if not exists ref_set_on date;
--   alter table wish_alert_events add column if not exists created_at timestamptz not null default now(),
--     add column if not exists send_after timestamptz not null default now(),
--     add column if not exists sent_at timestamptz;
--   update wish_alert_events set created_at = created_on::timestamp at time zone 'Europe/Paris',
--     send_after = created_on::timestamp at time zone 'Europe/Paris',
--     sent_at = case when status = 'sent' then sent_on::timestamp at time zone 'Europe/Paris' end;
--   alter table wish_watches add column if not exists last_sent_price_drop_at timestamptz,
--     add column if not exists last_sent_restock_at timestamptz,
--     add column if not exists last_sent_sold_out_at timestamptz;
-- 2. rejouer 0036_alertes_prix.sql, puis 0040_alertes_garde_fous.sql, en
--    entier (rejouables sans effet : ils remettent les fonctions d'avant et
--    la sonde à 2) ;
-- 3. puis :
--   alter table wish_watches drop column if exists target_price, drop column if exists target_currency,
--     drop column if exists target_country, drop column if exists below_target;
--   alter table wish_alert_events drop column if exists sent_on;
--   alter table stock_reports drop column if exists in_streak, drop column if exists helps_others;
--   alter table profiles drop column if exists help_others;
-- Ce qui est perdu : les seuils choisis par les membres (la règle B de 0036
-- reprend : la première observation refixe la référence), les séries de
-- signalements en cours, le réglage « Aider les autres membres » (tout le
-- monde aide de nouveau) ; les heures de 0036 reviennent arrondies au jour.
--
-- Ce qu'elle change :
-- 1. Empreinte d'une pièce : le SHA-256 du lien normalisé de la boutique
--    (serveur, lib/alertKeys.ts, version 2 ; le script de rattrapage recalcule
--    les empreintes). Plus aucune clé « page de Google » : un résultat sans
--    lien direct vers la boutique n'a jamais d'alerte.
-- 2. Baisse de prix : un SEUIL choisi par le membre sur chaque cloche
--    (wish_watches.target_price, target_currency, target_country) remplace
--    le prix de référence de 0036 (wish_tracking.ref_*, retirées ; un seuil
--    est repris de la référence quand la cloche « baisse » est allumée). Sans
--    seuil, le premier prix vu dans le pays et la devise du membre le devient.
--    Une alerte seulement quand un prix observé (même empreinte, même pays,
--    même devise) PASSE sous le seuil : below_target le retient, une alerte
--    par passage ; revenu au seuil ou au-dessus, la cloche se réarme.
-- 3. Rupture et retour en stock : « épuisée » pour TOUS les membres quand
--    Google l'annonce (s = false, origine 'shop'), ou quand 3 membres
--    différents l'ont signalée d'affilée (origine 'members') : signalements
--    sans aucune observation « en stock » entre eux (stock_reports.in_streak,
--    remis à faux par une observation « en stock » d'un membre qui aide les
--    autres), membres qui aident les autres seulement (helps_others au moment
--    du signalement ET help_others aujourd'hui). Avant (1 ou 2 auteurs),
--    seules les envies de l'auteur passent « épuisée » (origine 'reported',
--    jamais d'alerte au retour) ; ceci remplace la règle des 2 auteurs de
--    0040. « De retour en stock » : seulement après une rupture établie, et
--    seulement si la recherche qui voit la pièce en stock vient d'un membre
--    qui n'est PAS l'un des auteurs de la série en cours. La limite « une
--    alerte par envie et par sorte sur 7 jours » disparaît (le seuil la
--    remplace) ; « 5 alertes envoyées par personne et par jour » reste.
-- 4. « Aider les autres membres » (profiles.help_others, allumé par défaut,
--    distinct de « Alertes prix et stock ») : coupé, les recherches et les
--    signalements du membre ne servent qu'à SES envies (wish_observe et
--    wish_stock_report lisent ce réglage), ne touchent jamais la série des
--    signalements et ne comptent pas parmi les 3.
-- 5. Rien ne relie une alerte à son origine : wish_alert_events n'a aucune
--    colonne de recherche, de signalement ni de membre à l'origine ;
--    wish_observe reçoit le membre qui cherche (p_observer) seulement pour
--    appliquer son réglage et la règle des auteurs, sans le garder nulle
--    part. Les signalements gardent leur auteur dans leur propre table
--    (limite du jour, export, effacement à 30 jours), sans lien avec une alerte.
-- 6. Heures : seul le JOUR (heure de Paris) est gardé pour la création et
--    l'envoi d'une alerte (created_on, sent_on). Une heure exacte n'est
--    gardée que pendant l'envoi lui-même, le temps qu'il faut techniquement :
--    la réservation (claimed_at, pushing_at, 15 minutes au plus) empêche deux
--    envois si le serveur redémarre en plein envoi ; elle est effacée dès que
--    l'alerte est envoyée, expirée, périmée, désactivée ou rendue (règle de
--    la base). Retirées : wish_alert_events.created_at, send_after, sent_at et
--    wish_watches.last_sent_*_at (plus aucune règle ne demande l'heure : sans
--    la limite des 7 jours, le jour d'envoi suffit à la limite des 5 par
--    jour). Pourquoi : une heure exacte de création ou d'envoi permettrait de
--    rapprocher une alerte de la recherche qui l'a fait naître (même minute).
--    Une alerte jamais envoyée expire le 3e jour après sa création (par date).
-- 7. wish_alerts_claim ne renvoie plus que l'alerte, sa sorte, l'envie et la
--    langue : la notification est générique (ni titre, ni boutique, ni prix).
-- 8. wish_alerts_version répond 3 : le serveur n'allume les alertes qu'avec 0041.
--
-- Demande 0040 (et donc 0036) : refusée sans elle. Aucun déclencheur : rien
-- n'écrit dans une autre table pendant la suppression d'un compte (les
-- cascades de 0036 suffisent ; les signalements d'un compte supprimé quittent
-- simplement la série). À appliquer UNIQUEMENT sur spotto-dev-2 (migrer-dev)
-- tant que le fondateur ne décide pas autre chose, toujours après 0040, et
-- avec le serveur de ce lot (un serveur d'avant appelle les fonctions de
-- 0040, retirées ou changées ici : ses observations et ses envois échouent
-- sans rien envoyer, et le journal le dit).
-- Rejouable sans effet (if not exists, if exists, create or replace ; les
-- reprises de données ne tournent qu'une fois). Seul le serveur, avec sa clé
-- secrète, appelle ces fonctions.

do $$
begin
  if to_regclass('public.wish_tracking') is null or to_regclass('public.stock_reports') is null
     or to_regprocedure('public.wish_mark_bought(uuid, text, text, boolean, timestamptz)') is null then
    raise exception '0041 demande la migration 0040 (garde-fous des alertes) : appliquez-la d''abord.';
  end if;
end;
$$;

-- ---- « Aider les autres membres » (allumé par défaut) ----
alter table profiles add column if not exists help_others boolean not null default true;

-- ---- Seuil de la baisse de prix, sur la cloche ----
alter table wish_watches add column if not exists target_price numeric(10,2) check (target_price is null or target_price > 0);
alter table wish_watches add column if not exists target_currency text check (target_currency is null or target_currency ~ '^[A-Z]{3}$');
alter table wish_watches add column if not exists target_country text check (target_country is null or target_country ~ '^[a-z]{2}$');
alter table wish_watches add column if not exists below_target boolean not null default false;

-- Reprise (une seule fois, tant que la référence de 0036 existe) : la
-- référence d'une cloche « baisse » devient son seuil ; puis la référence part.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'wish_tracking' and column_name = 'ref_price') then
    execute $sql$
      update wish_watches w
         set target_price = t.ref_price, target_currency = t.ref_currency, target_country = t.ref_country,
             below_target = (t.last_price is not null and t.last_currency = t.ref_currency
                             and t.last_country = t.ref_country and t.last_price < t.ref_price)
        from wish_tracking t
       where t.wishlist_item_id = w.wishlist_item_id and w.notify_price_drop and w.target_price is null
         and t.ref_price is not null and t.ref_currency is not null and t.ref_country is not null
    $sql$;
  end if;
end;
$$;
alter table wish_tracking drop column if exists ref_price;
alter table wish_tracking drop column if exists ref_currency;
alter table wish_tracking drop column if exists ref_country;
alter table wish_tracking drop column if exists ref_set_on;
alter table wish_watches drop column if exists last_sent_price_drop_at;
alter table wish_watches drop column if exists last_sent_restock_at;
alter table wish_watches drop column if exists last_sent_sold_out_at;

-- ---- Signalements : la série en cours, et s'ils aident les autres ----
-- Les signalements d'avant 0041 ne font partie d'aucune série (dans le doute,
-- aucune rupture établie) : la colonne arrive à faux, puis vaut vrai pour les nouveaux.
alter table stock_reports add column if not exists in_streak boolean not null default false;
alter table stock_reports alter column in_streak set default true;
alter table stock_reports add column if not exists helps_others boolean not null default true;
create index if not exists stock_reports_streak_idx on stock_reports (match_key_hash) where in_streak;

-- ---- Origine d'un « épuisée » : 'shop', 'members' (3 d'affilée) ou 'reported' ----
-- Une seule fois (la règle de 0040 n'a pas encore 'reported') : un
-- « épuisée » venu des membres avant 0041 n'était pas établi par 3 membres
-- d'affilée. Il reste sur les envies de qui a signalé la pièce ('reported',
-- jamais d'alerte au retour) ; ailleurs (règle des 2 auteurs, ou origine
-- inconnue), l'état redevient inconnu.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.wish_tracking'::regclass and conname = 'wish_tracking_sold_out_source_check'
                   and pg_get_constraintdef(oid) like '%reported%') then
    alter table wish_tracking drop constraint if exists wish_tracking_sold_out_source_check;
    update wish_tracking t set sold_out_source = 'reported'
     where t.sold_out_source = 'members'
       and exists (select 1 from stock_reports r where r.user_id = t.user_id and r.match_key_hash = t.match_key_hash);
    update wish_tracking set stock_state = 'unknown', sold_out_source = null where sold_out_source = 'members';
    alter table wish_tracking add constraint wish_tracking_sold_out_source_check
      check ((sold_out_source is null or sold_out_source in ('shop', 'members', 'reported'))
             and ((stock_state = 'sold_out') = (sold_out_source is not null)));
  end if;
end;
$$;

-- ---- Alertes : le jour seulement ----
alter table wish_alert_events add column if not exists sent_on date;
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'wish_alert_events' and column_name = 'sent_at') then
    execute $sql$
      update wish_alert_events
         set sent_on = (coalesce(sent_at, pushing_at) at time zone 'Europe/Paris')::date
       where status = 'sent' and sent_on is null and coalesce(sent_at, pushing_at) is not null
    $sql$;
  end if;
end;
$$;
update wish_alert_events set sent_on = created_on where status = 'sent' and sent_on is null;
update wish_alert_events set sent_on = null where status <> 'sent' and sent_on is not null;
-- La réservation n'a plus lieu d'être une fois l'alerte close.
update wish_alert_events set claimed_at = null, pushing_at = null
 where status <> 'pending' and (claimed_at is not null or pushing_at is not null);
alter table wish_alert_events drop column if exists created_at;
alter table wish_alert_events drop column if exists send_after;
alter table wish_alert_events drop column if exists sent_at;
create index if not exists wish_alert_events_pending_day_idx on wish_alert_events (created_on, id) where status = 'pending';
create index if not exists wish_alert_events_sent_day_idx on wish_alert_events (user_id, sent_on) where status = 'sent';
create index if not exists wish_alert_events_created_on_idx on wish_alert_events (created_on);

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.wish_alert_events'::regclass and conname = 'wish_alert_events_sent_on_check') then
    -- Un jour d'envoi pour chaque alerte envoyée, et seulement pour elle.
    alter table wish_alert_events add constraint wish_alert_events_sent_on_check
      check ((status = 'sent') = (sent_on is not null));
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.wish_alert_events'::regclass and conname = 'wish_alert_events_lease_cleared_check') then
    -- L'heure exacte (réservation) n'existe que pendant l'envoi.
    alter table wish_alert_events add constraint wish_alert_events_lease_cleared_check
      check (status = 'pending' or (claimed_at is null and pushing_at is null));
  end if;
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.wish_watches'::regclass and conname = 'wish_watches_target_check') then
    -- Un seuil est complet (prix, devise, pays) ou absent.
    alter table wish_watches add constraint wish_watches_target_check
      check ((target_price is null) = (target_currency is null) and (target_price is null) = (target_country is null)
             and (target_price is not null or not below_target));
  end if;
end;
$$;

-- ---- Sonde du serveur : 3 = nouvelle version ----
create or replace function wish_alerts_version()
returns integer
language plpgsql
stable
set search_path = public
as $$
begin
  return 3;
end;
$$;

-- ---- Une observation par lot (après la réponse d'une recherche) ----
-- p_batch : comme en 0036 (k, m, p, c, n, s ; 200 au plus). p_observer : le
-- membre qui a cherché, lu seulement pour son réglage « Aider les autres
-- membres » et la règle des auteurs ; jamais gardé, jamais écrit avec une alerte.
-- Pour chaque pièce, sous un verrou par empreinte (« wish_key: ») :
-- - s = true : les auteurs de la série en cours sont lus (le membre qui
--   cherche en est-il ?), puis la série est close si le membre aide les autres ;
-- - une seule envie par membre (cloche allumée d'abord, puis l'identifiant le
--   plus petit), seulement les siennes si le membre n'aide pas les autres,
--   verrouillée :
--   - stock : s = true après une rupture établie ('shop' ou 'members'), si le
--     membre qui cherche n'est pas l'un des auteurs de la série → alerte
--     « retour en stock » (cloche et interrupteur allumés, pièce pas
--     achetée) ; puis « disponible ». s = false → « épuisée », origine 'shop'
--     (alerte « épuisée » si la rupture n'était pas déjà établie) ;
--   - prix : seulement une observation du pays du membre (member_country ;
--     sans lui, celui du dernier prix vu) ; sur une cloche « baisse » : sans
--     seuil, ce prix le devient ; sinon (même pays, même devise que le seuil)
--     sous le seuil alors qu'il ne l'était pas, pièce pas « épuisée » → une
--     alerte (old_price : le seuil ; new_price : le prix vu) ; au seuil ou
--     au-dessus → réarmée ;
--   - pièce achetée (bought_on, ou même proposition dans le Vault) : aucune alerte ;
--   - les lignes ne sont réécrites que si quelque chose change.
-- Verrou partagé « wish_alerts » d'abord, puis les empreintes dans l'ordre,
-- puis les suivis dans l'ordre. p_now : un instant fixé, pour les tests seulement.
drop function if exists wish_observe(jsonb, timestamptz);
create or replace function wish_observe(p_batch jsonb, p_observer uuid, p_now timestamptz default null)
returns table (matched integer, events integer)
language plpgsql
set search_path = public
as $$
declare
  v_today date := (coalesce(p_now, now()) at time zone 'Europe/Paris')::date;
  v_help boolean;
  v_obs jsonb;
  v_key text;
  v_merchant text;
  v_amount numeric;
  v_cents bigint;
  v_currency text;
  v_country text;
  v_stock boolean;
  v_observer_reported boolean;
  v_ids uuid[];
  t record;
  v_alerts boolean;
  v_confirmed boolean;
  v_new_stock text;
  v_new_source text;
  v_new_stock_on date;
  v_row_country text;
  v_last_price numeric(10,2);
  v_last_currency text;
  v_last_country text;
  v_target_price numeric(10,2);
  v_target_currency text;
  v_target_country text;
  v_below boolean;
  v_rows integer;
  v_matched integer := 0;
  v_events integer := 0;
begin
  if p_batch is null or jsonb_typeof(p_batch) <> 'array' or jsonb_array_length(p_batch) > 200 or p_observer is null then
    raise exception 'wish_observe : lot invalide';
  end if;
  -- Membre inconnu : comme un membre qui n'aide pas les autres (il n'a aucune envie).
  select coalesce(p.help_others, false) into v_help from profiles p where p.id = p_observer;
  v_help := coalesce(v_help, false);
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

    -- Une pièce à la fois (série des signalements comprise), dans l'ordre des empreintes.
    perform pg_advisory_xact_lock(hashtext('wish_key:' || v_key));
    v_observer_reported := false;
    if v_stock is true then
      v_observer_reported := exists (select 1 from stock_reports r
                                      where r.match_key_hash = v_key and r.in_streak and r.user_id = p_observer);
      -- « En stock » vu par un membre qui aide les autres : la série est close.
      if v_help then
        update stock_reports set in_streak = false where match_key_hash = v_key and in_streak;
      end if;
    end if;

    -- Une seule envie par membre pour cette pièce (lecture sans verrou ; revérifiée ci-dessous).
    select coalesce(array_agg(c.id order by c.id), '{}'::uuid[]) into v_ids
      from (select distinct on (tr.user_id) tr.wishlist_item_id as id
              from wish_tracking tr
              left join wish_watches ww on ww.wishlist_item_id = tr.wishlist_item_id
             where tr.match_key_hash = v_key
               and (tr.merchant_key is null or v_merchant is null or tr.merchant_key = v_merchant)
               and (v_help or tr.user_id = p_observer)
             order by tr.user_id,
                      (coalesce(ww.notify_price_drop, false) or coalesce(ww.notify_restock, false) or coalesce(ww.notify_sold_out, false)) desc,
                      tr.wishlist_item_id) c;

    for t in
      select tr.wishlist_item_id, tr.user_id, tr.stock_state, tr.stock_on, tr.sold_out_source, tr.member_country,
             tr.last_price, tr.last_currency, tr.last_country,
             coalesce(p.price_alerts_enabled, false) as alerts_enabled,
             ww.wishlist_item_id is not null as has_watch,
             coalesce(ww.notify_price_drop, false) as watch_price_drop,
             coalesce(ww.notify_restock, false) as watch_restock,
             coalesce(ww.notify_sold_out, false) as watch_sold_out,
             ww.target_price, ww.target_currency, ww.target_country, coalesce(ww.below_target, false) as below_target,
             (tr.bought_on is not null or (w.product_match_id is not null and exists (
                select 1 from vault_items v where v.user_id = tr.user_id and v.product_match_id = w.product_match_id
             ))) as bought
        from wish_tracking tr
        join wishlist_items w on w.id = tr.wishlist_item_id
        join profiles p on p.id = tr.user_id
        left join wish_watches ww on ww.wishlist_item_id = tr.wishlist_item_id
       where tr.wishlist_item_id = any(v_ids)
         and tr.match_key_hash = v_key
         and (v_help or tr.user_id = p_observer)
       order by tr.wishlist_item_id
       for update of tr
    loop
      v_matched := v_matched + 1;
      v_alerts := t.alerts_enabled and not t.bought;
      v_confirmed := t.stock_state = 'sold_out' and t.sold_out_source in ('shop', 'members');
      v_new_stock := t.stock_state;
      v_new_source := t.sold_out_source;
      v_new_stock_on := t.stock_on;

      -- Stock : seulement une annonce explicite.
      if v_stock is true then
        -- « De retour en stock » : rupture établie, vue en stock par un membre
        -- qui n'est pas l'un des auteurs de la série en cours.
        if v_confirmed and not v_observer_reported and v_alerts and t.watch_restock then
          insert into wish_alert_events (wishlist_item_id, user_id, kind, created_on)
          values (t.wishlist_item_id, t.user_id, 'restock', v_today)
          on conflict (wishlist_item_id, kind) where status = 'pending' do nothing;
          get diagnostics v_rows = row_count;
          v_events := v_events + v_rows;
        end if;
        v_new_stock := 'in_stock';
        v_new_source := null;
        v_new_stock_on := v_today;
      elsif v_stock is false then
        if not v_confirmed and v_alerts and t.watch_sold_out then
          insert into wish_alert_events (wishlist_item_id, user_id, kind, created_on)
          values (t.wishlist_item_id, t.user_id, 'sold_out', v_today)
          on conflict (wishlist_item_id, kind) where status = 'pending' do nothing;
          get diagnostics v_rows = row_count;
          v_events := v_events + v_rows;
        end if;
        v_new_stock := 'sold_out';
        v_new_source := case when t.stock_state = 'sold_out' and t.sold_out_source = 'members' then 'members' else 'shop' end;
        v_new_stock_on := v_today;
      end if;

      -- Prix : seulement une observation du pays du membre.
      v_last_price := t.last_price;
      v_last_currency := t.last_currency;
      v_last_country := t.last_country;
      v_target_price := t.target_price;
      v_target_currency := t.target_currency;
      v_target_country := t.target_country;
      v_below := t.below_target;
      v_row_country := coalesce(t.member_country, t.last_country);
      if v_cents is not null and (v_row_country is null or v_country = v_row_country) then
        v_last_price := v_cents / 100.0;
        v_last_currency := v_currency;
        v_last_country := v_country;
        if t.watch_price_drop then
          if t.target_price is null then
            -- Sans seuil : le premier prix vu le devient, sans alerte.
            v_target_price := v_cents / 100.0;
            v_target_currency := v_currency;
            v_target_country := v_country;
            v_below := false;
          elsif t.target_currency = v_currency and t.target_country = v_country then
            if v_cents < round(t.target_price * 100) then
              -- Une alerte par passage sous le seuil (jamais pour une pièce épuisée).
              if not t.below_target and v_new_stock <> 'sold_out' then
                v_below := true;
                if v_alerts then
                  insert into wish_alert_events (wishlist_item_id, user_id, kind, old_price, new_price, currency, created_on)
                  values (t.wishlist_item_id, t.user_id, 'price_drop', t.target_price, v_cents / 100.0, v_currency, v_today)
                  on conflict (wishlist_item_id, kind) where status = 'pending' do nothing;
                  get diagnostics v_rows = row_count;
                  v_events := v_events + v_rows;
                end if;
              end if;
            else
              -- Revenu au seuil ou au-dessus : la cloche se réarme.
              v_below := false;
            end if;
          end if;
        end if;
      end if;

      -- Réécrites seulement si quelque chose change (updated_at ne bouge
      -- jamais : le suivi ne garde que des jours).
      update wish_tracking tr
         set last_price = v_last_price,
             last_currency = v_last_currency,
             last_country = v_last_country,
             last_seen_on = v_today,
             stock_state = v_new_stock,
             sold_out_source = v_new_source,
             stock_on = v_new_stock_on
       where tr.wishlist_item_id = t.wishlist_item_id
         and (tr.last_price, tr.last_currency, tr.last_country, tr.last_seen_on, tr.stock_state, tr.sold_out_source, tr.stock_on)
             is distinct from
             (v_last_price, v_last_currency, v_last_country, v_today, v_new_stock, v_new_source, v_new_stock_on);
      if t.has_watch then
        update wish_watches ww
           set target_price = v_target_price, target_currency = v_target_currency,
               target_country = v_target_country, below_target = v_below
         where ww.wishlist_item_id = t.wishlist_item_id
           and (ww.target_price, ww.target_currency, ww.target_country, ww.below_target)
               is distinct from (v_target_price, v_target_currency, v_target_country, v_below);
      end if;
    end loop;
  end loop;
  return query select v_matched, v_events;
end;
$$;

-- ---- « Plus disponible » : signalement d'un membre ----
-- Limite de p_daily_cap par membre et par jour de Paris, sous un verrou par
-- membre ; le signalement est gardé (le membre, l'empreinte, le jour, s'il
-- aide les autres ; jamais lié à une alerte). Puis, sous le verrou de
-- l'empreinte : les auteurs différents de la série en cours qui aident les
-- autres sont comptés. Si le membre aide les autres et qu'ils sont au moins
-- 3, la rupture est établie : toutes les envies de la pièce passent
-- « épuisée » (origine 'members' ; 'shop' le reste), et la cloche « épuisée »
-- (cachée dans l'app) prévient les membres qui ne sont pas auteurs de la
-- série. Sinon, seules SES envies passent « épuisée » (origine 'reported',
-- une rupture établie le reste). Une envie déjà « épuisée » ce jour-là avec
-- la même origine n'est pas réécrite. matched : les envies réécrites.
create or replace function wish_stock_report(p_user_id uuid, p_key text, p_merchant text, p_daily_cap integer, p_now timestamptz default null)
returns table (allowed boolean, matched integer)
language plpgsql
set search_path = public
as $$
declare
  v_today date := (coalesce(p_now, now()) at time zone 'Europe/Paris')::date;
  v_merchant text := case when coalesce(p_merchant, '') ~ '^[a-z0-9]{1,80}$' then p_merchant end;
  v_help boolean;
  v_count integer;
  v_reporters integer;
  v_confirmed boolean;
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
  select coalesce(p.help_others, false) into v_help from profiles p where p.id = p_user_id;
  v_help := coalesce(v_help, false);
  perform pg_advisory_xact_lock_shared(hashtext('wish_alerts'));
  perform pg_advisory_xact_lock(hashtext('wish_key:' || p_key));
  insert into stock_reports (user_id, match_key_hash, created_on, in_streak, helps_others)
  values (p_user_id, p_key, v_today, true, v_help);
  -- Auteurs différents de la série en cours, qui aident les autres (hier comme aujourd'hui).
  select count(distinct r.user_id) into v_reporters
    from stock_reports r
    join profiles p on p.id = r.user_id
   where r.match_key_hash = p_key and r.in_streak and r.helps_others and p.help_others;
  v_confirmed := v_help and v_reporters >= 3;

  if v_confirmed then
    -- Rupture établie : la cloche « épuisée » des membres qui ne sont pas auteurs de la série.
    insert into wish_alert_events (wishlist_item_id, user_id, kind, created_on)
    select tr.wishlist_item_id, tr.user_id, 'sold_out', v_today
      from wish_tracking tr
      join wishlist_items w on w.id = tr.wishlist_item_id
      join profiles p on p.id = tr.user_id
      join wish_watches ww on ww.wishlist_item_id = tr.wishlist_item_id
     where tr.match_key_hash = p_key
       and (tr.merchant_key is null or v_merchant is null or tr.merchant_key = v_merchant)
       and not (tr.stock_state = 'sold_out' and tr.sold_out_source in ('shop', 'members'))
       and p.price_alerts_enabled and ww.notify_sold_out and tr.bought_on is null
       and not (w.product_match_id is not null and exists (
              select 1 from vault_items v where v.user_id = tr.user_id and v.product_match_id = w.product_match_id))
       and not exists (select 1 from stock_reports r where r.match_key_hash = p_key and r.in_streak and r.user_id = tr.user_id)
    on conflict (wishlist_item_id, kind) where status = 'pending' do nothing;
  end if;

  -- updated_at ne bouge pas : le suivi ne garde que des jours.
  update wish_tracking tr
     set stock_state = 'sold_out',
         stock_on = v_today,
         sold_out_source = case when tr.stock_state = 'sold_out' and tr.sold_out_source in ('shop', 'members') then tr.sold_out_source
                                when v_confirmed then 'members'
                                else 'reported' end
   where tr.wishlist_item_id in (
           select t.wishlist_item_id from wish_tracking t
            where t.match_key_hash = p_key
              and (t.merchant_key is null or v_merchant is null or t.merchant_key = v_merchant)
              and (v_confirmed or t.user_id = p_user_id)
              and (t.stock_state <> 'sold_out' or t.stock_on is distinct from v_today
                   or (v_confirmed and t.sold_out_source = 'reported'))
            order by t.wishlist_item_id
            for update);
  get diagnostics v_matched = row_count;
  return query select true, v_matched;
end;
$$;

-- ---- Les alertes à envoyer (une file, sans tâche de fond) ----
-- Dans l'ordre, sous le verrou exclusif « wish_alerts » (un seul envoi à la
-- fois, jamais pendant une observation) :
-- 0. envoi demandé à Expo (pushing_at) sans avoir pu être noté, réservation
--    échue (15 minutes) → « envoyée » (peut-être reçue : jamais deux fois) ;
-- 1. créées il y a 3 jours ou plus (dates de Paris), sans envoi en cours → « expirée » ;
-- 2. sans envoi en cours, mais interrupteur coupé ou cloche de cette sorte
--    coupée → « désactivée » ;
-- 3. p_limit = 0 (notifications coupées sur le serveur) : rien d'autre ;
-- 4. sinon, les alertes des membres qui ont un appareil prêt pour les
--    alertes et moins de 5 alertes envoyées ce jour de Paris (sinon elles
--    attendent le lendemain, dans leurs 3 jours), les plus anciennes d'abord :
--    - revérifiées : pièce achetée, prix revenu au seuil ou au-dessus
--      (below_target), pièce épuisée (baisse), ou stock qui n'est plus celui
--      annoncé → « périmée » ;
--    - les autres sont réservées (claimed_at, la seule heure exacte, effacée
--      à la fin de l'envoi) et renvoyées : l'alerte, sa sorte, l'envie et la
--      langue, rien d'autre (notification générique).
-- p_now : un instant fixé, pour les tests seulement ; seules les alertes
-- créées dans les 30 jours avant lui sont alors regardées (et, sans lui,
-- jamais une alerte datée d'après aujourd'hui) : un test qui vit dans une
-- autre année ne touche jamais les alertes réelles de la base.
drop function if exists wish_alerts_claim(integer, timestamptz);
create or replace function wish_alerts_claim(p_limit integer, p_now timestamptz default null)
returns table (
  event_id uuid,
  user_id uuid,
  wishlist_item_id uuid,
  kind text,
  locale text
)
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  v_today date := (coalesce(p_now, now()) at time zone 'Europe/Paris')::date;
  v_since date := case when p_now is null then '-infinity'::date else (coalesce(p_now, now()) at time zone 'Europe/Paris')::date - 30 end;
  v_lease timestamptz := coalesce(p_now, now()) - interval '15 minutes';
  e record;
  v_status text;
begin
  if p_limit is null or p_limit < 0 or p_limit > 200 then
    raise exception 'wish_alerts_claim : limite invalide';
  end if;
  perform pg_advisory_xact_lock(hashtext('wish_alerts'));

  -- 0. Envoi peut-être reçu, jamais noté : « envoyée ».
  perform wish_alerts_mark_sent(array(
    select ev.id from wish_alert_events ev
     where ev.status = 'pending' and ev.pushing_at is not null and ev.claimed_at < v_lease
       and ev.created_on between v_since and v_today
     order by ev.id
     limit 200), v_now);

  -- 1. Expirées (jamais une alerte dont l'envoi est en cours ailleurs).
  update wish_alert_events ev
     set status = 'expired', claimed_at = null
   where ev.status = 'pending' and ev.created_on <= v_today - 3 and ev.created_on >= v_since
     and ev.pushing_at is null
     and (ev.claimed_at is null or ev.claimed_at < v_lease);

  -- 2. Désactivées.
  update wish_alert_events ev
     set status = 'disabled', claimed_at = null
   where ev.status = 'pending' and ev.created_on between v_since and v_today
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
           tr.stock_state, tr.bought_on, coalesce(ww.below_target, false) as below_target,
           w.product_match_id, p.locale as owner_locale
      from wish_alert_events ev
      join wish_tracking tr on tr.wishlist_item_id = ev.wishlist_item_id
      join wishlist_items w on w.id = ev.wishlist_item_id
      join profiles p on p.id = ev.user_id
      left join wish_watches ww on ww.wishlist_item_id = ev.wishlist_item_id
     where ev.status = 'pending' and ev.created_on between v_since and v_today
       and ev.pushing_at is null
       and (ev.claimed_at is null or ev.claimed_at < v_lease)
       and exists (select 1 from push_tokens pt where pt.user_id = ev.user_id and pt.notify_alerts)
       and (select count(*) from wish_alert_events s
             where s.user_id = ev.user_id
               and ((s.status = 'sent' and s.sent_on = v_today)
                    or (s.status = 'pending' and s.claimed_at >= v_lease))) < 5
     order by ev.created_on, ev.id
     limit p_limit
     for update of ev
  loop
    v_status := null;
    if e.bought_on is not null
       or (e.product_match_id is not null
           and exists (select 1 from vault_items v where v.user_id = e.owner_id and v.product_match_id = e.product_match_id)) then
      v_status := 'stale';
    elsif e.alert_kind = 'price_drop' and (not e.below_target or e.stock_state = 'sold_out') then
      v_status := 'stale';
    elsif e.alert_kind = 'restock' and e.stock_state <> 'in_stock' then
      v_status := 'stale';
    elsif e.alert_kind = 'sold_out' and e.stock_state <> 'sold_out' then
      v_status := 'stale';
    elsif (select count(*) from wish_alert_events s
            where s.user_id = e.owner_id and s.id <> e.id
              and ((s.status = 'sent' and s.sent_on = v_today)
                   or (s.status = 'pending' and s.claimed_at >= v_lease))) >= 5 then
      -- 5 déjà aujourd'hui (celles de ce passage comprises) : elle attend le lendemain.
      v_status := 'held';
    end if;

    if v_status = 'held' then
      null;
    elsif v_status is not null then
      update wish_alert_events set status = v_status, claimed_at = null where id = e.id;
    else
      update wish_alert_events set claimed_at = v_now where id = e.id;
      event_id := e.id;
      user_id := e.owner_id;
      wishlist_item_id := e.item_id;
      kind := e.alert_kind;
      locale := e.owner_locale;
      return next;
    end if;
  end loop;
end;
$$;

-- ---- Alertes envoyées : « envoyée », le jour seulement ----
-- Seulement les alertes réservées encore en attente. Le jour d'envoi est
-- celui de la demande à Expo (pushing_at) s'il est connu ; la réservation
-- (claimed_at, pushing_at) est effacée. Le seuil ne bouge pas : une alerte
-- par passage sous le seuil. p_now : pour les tests seulement. Verrou
-- exclusif « wish_alerts » (rejouable dans la même transaction).
create or replace function wish_alerts_mark_sent(p_ids uuid[], p_now timestamptz default null)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_today date := (coalesce(p_now, now()) at time zone 'Europe/Paris')::date;
  v_count integer;
begin
  if p_ids is null or cardinality(p_ids) > 200 then
    raise exception 'wish_alerts_mark_sent : liste invalide';
  end if;
  perform pg_advisory_xact_lock(hashtext('wish_alerts'));
  update wish_alert_events ev
     set status = 'sent',
         sent_on = coalesce((ev.pushing_at at time zone 'Europe/Paris')::date, v_today),
         claimed_at = null,
         pushing_at = null
   where ev.id = any(p_ids) and ev.status = 'pending' and ev.claimed_at is not null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---- Effacement des alertes et des signalements de plus de 30 jours ----
-- Par date (created_on), borné (p_limit lignes de chaque table au plus par
-- appel). p_now : pour les tests seulement ; seules les lignes des 2 années
-- avant lui sont alors effacées (jamais les lignes réelles de la base).
create or replace function wish_alerts_purge(p_limit integer, p_now timestamptz default null)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_today date := (coalesce(p_now, now()) at time zone 'Europe/Paris')::date;
  v_since date := case when p_now is null then '-infinity'::date else (coalesce(p_now, now()) at time zone 'Europe/Paris')::date - 730 end;
  v_events integer;
  v_reports integer;
begin
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'wish_alerts_purge : limite invalide';
  end if;
  perform pg_advisory_xact_lock(hashtext('wish_alerts'));
  delete from wish_alert_events
   where id in (select id from wish_alert_events where created_on < v_today - 30 and created_on >= v_since limit p_limit);
  get diagnostics v_events = row_count;
  delete from stock_reports
   where id in (select id from stock_reports where created_on < v_today - 30 and created_on >= v_since limit p_limit);
  get diagnostics v_reports = row_count;
  return v_events + v_reports;
end;
$$;

revoke all on function wish_alerts_version() from public, anon, authenticated;
grant execute on function wish_alerts_version() to service_role;
revoke all on function wish_observe(jsonb, uuid, timestamptz) from public, anon, authenticated;
grant execute on function wish_observe(jsonb, uuid, timestamptz) to service_role;
revoke all on function wish_stock_report(uuid, text, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function wish_stock_report(uuid, text, text, integer, timestamptz) to service_role;
revoke all on function wish_alerts_claim(integer, timestamptz) from public, anon, authenticated;
grant execute on function wish_alerts_claim(integer, timestamptz) to service_role;
revoke all on function wish_alerts_mark_sent(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function wish_alerts_mark_sent(uuid[], timestamptz) to service_role;
revoke all on function wish_alerts_purge(integer, timestamptz) from public, anon, authenticated;
grant execute on function wish_alerts_purge(integer, timestamptz) to service_role;

notify pgrst, 'reload schema';
