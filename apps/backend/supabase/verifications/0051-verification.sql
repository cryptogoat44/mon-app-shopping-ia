-- Vérification de la migration 0051 (notifications d'activité sur le
-- téléphone : quatre réponses de plus par appareil). Lecture seule. À lancer
-- sur la base où la migration vient d'être appliquée (spotto-dev-2, puis la
-- production).
--
-- Résultat attendu : une seule ligne, true | true | true, soit :
--   colonnes = true : push_tokens.notify_likes, notify_comments,
--     notify_follows et notify_mentions existent (oui / non, jamais vides,
--     faux par défaut) ;
--   aucun_appareil_allume = true : aucun appareil ne reçoit l'activité du
--     seul fait de la migration (à lire juste après l'avoir appliquée :
--     ensuite, des membres auront pu l'activer, et « false » est alors normal) ;
--   protegee = true : push_tokens garde sa RLS active, sans aucune règle
--     d'accès public ; ni les visiteurs ni les comptes connectés ne la
--     lisent, le serveur oui (les nouvelles colonnes ne sont lues que par lui).
-- Avant la migration (ou sans elle), sur une base qui a 0035 (déjà en
-- production) : false | false | true, sans erreur (protegee ne dépend pas de 0051).
-- Le jeton d'un appareil n'est jamais affiché : seulement un compte.
select
  (select count(*) from information_schema.columns
     where table_schema = 'public' and table_name = 'push_tokens'
       and column_name in ('notify_likes', 'notify_comments', 'notify_follows', 'notify_mentions')
       and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false') = 4 as colonnes,
  -- Avant la migration : faux (jamais une erreur pour une colonne absente).
  case when (select count(*) from information_schema.columns
               where table_schema = 'public' and table_name = 'push_tokens'
                 and column_name in ('notify_likes', 'notify_comments', 'notify_follows', 'notify_mentions')) < 4 then false else
  (select count(*) = 0 from push_tokens
     where (to_jsonb(push_tokens) ->> 'notify_likes') <> 'false'
        or (to_jsonb(push_tokens) ->> 'notify_comments') <> 'false'
        or (to_jsonb(push_tokens) ->> 'notify_follows') <> 'false'
        or (to_jsonb(push_tokens) ->> 'notify_mentions') <> 'false') end as aucun_appareil_allume,
  coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'push_tokens'), false)
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'push_tokens')
    and not has_table_privilege('anon', 'public.push_tokens', 'select')
    and not has_table_privilege('authenticated', 'public.push_tokens', 'select')
    and has_table_privilege('service_role', 'public.push_tokens', 'update') as protegee;
