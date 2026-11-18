-- 0043 (lot « messages vus », 2026-11-17) : les confirmations de lecture des
-- messages privés. Dans une conversation ouverte aux deux membres, la
-- personne qui a écrit voit « Vu » sous son dernier message quand l'autre
-- membre a ouvert la conversation après ce message, « Envoyé » sinon.
--
-- Retour en arrière (le serveur actuel fonctionne sans 0043 : plus personne
-- ne voit « Vu » ni « Envoyé », et le réglage n'est plus proposé ; le choix
-- de chaque membre est alors perdu, rien d'autre ne change. Appliquée de
-- nouveau ensuite, elle repart de zéro : aucune lecture d'avant n'est
-- montrée) :
--   alter table profiles drop column if exists read_receipts_since;
--   alter table profiles drop column if exists read_receipts;
--
-- Ce qu'elle ajoute :
-- 1. profiles.read_receipts : le réglage « Confirmations de lecture » de
--    chaque membre, allumé par défaut (true). Éteint (false) : l'autre membre
--    ne voit plus « Vu » pour ses lectures, et lui-même ne voit plus celles
--    des autres (réciproque : il suffit que l'un des deux l'ait éteint).
-- 2. profiles.read_receipts_since : le moment à partir duquel les lectures
--    de ce membre peuvent être montrées. Une lecture d'avant ce moment n'est
--    jamais montrée, même plus tard :
--    - membres déjà inscrits : le moment où cette migration est appliquée
--      (rien de ce qu'ils ont lu avant que « Vu » existe n'est montré, à
--      condition de l'appliquer APRÈS la mise en ligne : voir « ORDRE DE
--      MISE EN LIGNE » plus bas) ;
--    - nouveaux membres : la création de leur profil ;
--    - à chaque fois qu'un membre rallume le réglage, le serveur y écrit le
--      moment où il le rallume (ce qu'il a lu pendant que le réglage était
--      éteint n'est jamais montré ensuite).
--
-- Aucune table nouvelle. La date de la dernière lecture de chaque
-- conversation existe depuis 0032 (conversation_participants.last_read_at) ;
-- elle reste écrite comme avant. Le serveur ne la montre à l'autre membre
-- que dans une conversation ouverte : jamais pour une invitation en attente
-- ou refusée, ni pour une lecture faite avant que l'invitation soit acceptée,
-- ni pour une lecture d'avant read_receipts_since (lib/readReceipts.ts).
--
-- Facultative pour le serveur : sans elle, personne ne voit « Vu » ni
-- « Envoyé », et l'app ne propose pas le réglage (sonde du schéma,
-- lib/readReceipts.ts) : personne n'est exposé avant de pouvoir refuser. À
-- appliquer APRÈS 0032 (vérifié ci-dessous), d'abord sur spotto-dev-2
-- (migrer-dev), puis sur spotto-prod. Rejouable sans effet (une colonne
-- déjà là n'est pas touchée) ; ne supprime ni ne modifie aucune donnée
-- existante : elle n'écrit que dans la nouvelle colonne read_receipts_since.
-- Aucune règle d'accès ne change : profiles reste fermée au public (RLS
-- active, aucune politique) ; seul le serveur, avec sa clé secrète, lit et
-- écrit ce réglage et cette date.
--
-- ORDRE DE MISE EN LIGNE, sur spotto-prod : à appliquer APRÈS la mise en
-- ligne du serveur, de l'app (site) et de la politique de confidentialité
-- qui portent « Vu » et le réglage, jamais avant. Le serveur fonctionne sans
-- elle, et « Vu » apparaît dans les 5 minutes qui suivent son application.
-- Pourquoi : pour les membres déjà inscrits, la date « depuis » est le moment
-- où la migration est appliquée. Appliquée avant, ce qu'ils liraient entre
-- ce moment et la mise en ligne serait montré ensuite (« Vu »), alors que
-- ni la mention, ni le réglage, ni la politique n'existaient pour eux.
-- Si elle a quand même été appliquée avant : AVANT de mettre le serveur en
-- ligne, retirer la date « depuis » (le serveur se comporte alors comme
-- sans 0043 ; le réglage de chaque membre n'est pas touché) :
--   alter table profiles drop column if exists read_receipts_since;
-- puis, une fois le serveur, l'app et la politique en ligne, rejouer ce
-- fichier en entier : la date « depuis » de tous repart de ce moment-là.

do $$
begin
  if to_regclass('public.conversation_participants') is null then
    raise exception '0043 demande la migration 0032 (messages privés) : appliquez-la d''abord.';
  end if;
end;
$$;

-- ---- Réglage « Confirmations de lecture » (allumé par défaut) ----
alter table profiles add column if not exists read_receipts boolean not null default true;

-- ---- Depuis quand les lectures d'un membre peuvent être montrées ----
-- Seulement si la colonne n'existe pas encore : rejouée, la migration ne
-- touche à aucune date déjà là. Les membres déjà inscrits reçoivent le moment
-- de la migration (now()). Les lectures sont datées par l'horloge du serveur,
-- qui peut avancer de quelques instants sur celle de la base : pour un membre
-- dont une lecture est datée de ce moment ou d'après, la date est poussée
-- juste après cette lecture (une milliseconde). Aucune lecture déjà dans la
-- base n'est donc montrée, quelles que soient les horloges.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'read_receipts_since'
  ) then
    alter table profiles add column read_receipts_since timestamptz not null default now();
    update profiles p
      set read_receipts_since = r.latest + interval '1 millisecond'
      from (select user_id, max(last_read_at) as latest from conversation_participants group by user_id) r
      where r.user_id = p.id and r.latest + interval '1 millisecond' > p.read_receipts_since;
  end if;
end;
$$;

notify pgrst, 'reload schema';
