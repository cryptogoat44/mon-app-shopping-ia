-- 0051 (lot « découverte », 2026-11-19) : notifications d'activité sur le
-- téléphone. Sur chaque appareil déjà prévenu des messages ou des alertes
-- (push_tokens, 0035 et 0036), quatre réponses de plus, ÉTEINTES au départ :
-- les « j'aime », les commentaires et réponses, les abonnés et demandes
-- d'abonnement, les mentions et identifications.
--
-- Retour en arrière (après avoir remis un serveur qui ne connaît pas 0051 ;
-- les quatre réponses de chaque appareil sont alors perdues, rien d'autre).
-- D'abord, les appareils gardés pour la seule activité : un serveur plus
-- ancien ne leur enverrait plus rien, ils sont oubliés (l'app les
-- réenregistre à sa prochaine ouverture si les messages ou les alertes y
-- sont allumés) ; puis les colonnes :
--   delete from push_tokens where notify_messages = false and notify_alerts = false;
--   alter table push_tokens drop column if exists notify_mentions;
--   alter table push_tokens drop column if exists notify_follows;
--   alter table push_tokens drop column if exists notify_comments;
--   alter table push_tokens drop column if exists notify_likes;
--
-- Ce qu'elle ajoute :
-- 1. push_tokens.notify_likes, notify_comments, notify_follows et
--    notify_mentions : cet appareil reçoit-il une notification quand un
--    membre aime une publication de la personne ; la commente ou répond à son
--    commentaire ; s'abonne à elle, demande à la suivre ou accepte sa demande ;
--    la mentionne ou l'identifie sur une publication ? Oui / non, jamais vide,
--    faux par défaut : aucun appareil déjà enregistré ne reçoit quoi que ce
--    soit de nouveau sans l'« Activer » de la personne, sur cet appareil.
--    Un appareil reste enregistré tant que l'une de ses six réponses
--    (messages, alertes et ces quatre-là) est vraie ; effacé avec le compte.
-- Rien d'autre n'est enregistré : ni la notification envoyée, ni son texte,
-- ni l'heure. Le texte dit seulement qui a fait quoi (« @pseudo a aimé votre
-- publication »), jamais le texte d'un commentaire, une légende ni une image.
--
-- Facultative pour le serveur : sans elle, aucune notification d'activité
-- n'est envoyée, même avec PUSH_ENABLED=true ; le serveur ignore ces quatre
-- réponses et l'app cache leurs interrupteurs (sonde du schéma, lib/push.ts).
-- Demande 0036 (alertes prix, déjà en production), vérifiée ci-dessous avant
-- tout changement. Indépendante de 0045 à 0050 : sans 0045, les demandes
-- d'abonnement, réponses, mentions et identifications n'existent pas, donc
-- rien n'en est envoyé. D'abord sur spotto-dev-2 (migrer-dev), puis sur
-- spotto-prod. Rejouable sans effet (if not exists) ; ne supprime ni ne
-- modifie aucune donnée existante (quatre colonnes ajoutées avec leur valeur
-- par défaut).
-- Aucune règle d'accès nouvelle : push_tokens garde sa RLS active sans
-- politique, et ses droits (0035) : seul le serveur, avec sa clé secrète, la
-- lit et l'écrit.
-- Aucun déclencheur, aucune fonction, aucun index.

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'push_tokens' and column_name = 'notify_alerts') then
    raise exception '0051 demande la migration 0036 (alertes prix) : appliquez-la d''abord.';
  end if;
end;
$$;

-- ---- Ce que reçoit chaque appareil : l'activité ----
alter table push_tokens add column if not exists notify_likes boolean not null default false;
alter table push_tokens add column if not exists notify_comments boolean not null default false;
alter table push_tokens add column if not exists notify_follows boolean not null default false;
alter table push_tokens add column if not exists notify_mentions boolean not null default false;

notify pgrst, 'reload schema';
