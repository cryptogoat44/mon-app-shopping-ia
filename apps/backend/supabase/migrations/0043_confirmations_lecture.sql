-- 0043 (lot « messages vus », 2026-11-17) : les confirmations de lecture des
-- messages privés. Dans une conversation ouverte aux deux membres, la
-- personne qui a écrit voit « Vu » sous son dernier message quand l'autre
-- membre a ouvert la conversation après ce message, « Envoyé » sinon.
--
-- Retour en arrière (le serveur actuel fonctionne sans 0043 : plus personne
-- ne voit « Vu » ni « Envoyé », et le réglage n'est plus proposé ; le choix
-- de chaque membre est alors perdu, rien d'autre ne change) :
--   alter table profiles drop column if exists read_receipts;
--
-- Ce qu'elle ajoute :
-- profiles.read_receipts : le réglage « Confirmations de lecture » de chaque
-- membre, allumé par défaut (true). Éteint (false) : l'autre membre ne voit
-- plus « Vu » pour ses lectures, et lui-même ne voit plus celles des autres
-- (réciproque : il suffit que l'un des deux l'ait éteint).
--
-- Aucune table nouvelle, et aucune date nouvelle : la date de la dernière
-- lecture de chaque conversation existe depuis 0032
-- (conversation_participants.last_read_at). Le serveur ne la montre à
-- l'autre membre que dans une conversation ouverte : jamais pour une
-- invitation en attente ou refusée, ni pour une lecture faite avant que
-- l'invitation soit acceptée (lib/readReceipts.ts).
--
-- Facultative pour le serveur : sans elle, personne ne voit « Vu » ni
-- « Envoyé », et l'app ne propose pas le réglage (sonde du schéma,
-- lib/readReceipts.ts) : personne n'est exposé avant de pouvoir refuser. À
-- appliquer APRÈS 0032 (vérifié ci-dessous), d'abord sur spotto-dev-2
-- (migrer-dev), puis sur spotto-prod. Rejouable sans effet (add column if
-- not exists) ; ne supprime ni ne modifie aucune donnée existante.
-- Aucune règle d'accès ne change : profiles reste fermée au public (RLS
-- active, aucune politique) ; seul le serveur, avec sa clé secrète, lit et
-- écrit ce réglage.

do $$
begin
  if to_regclass('public.conversation_participants') is null then
    raise exception '0043 demande la migration 0032 (messages privés) : appliquez-la d''abord.';
  end if;
end;
$$;

-- ---- Réglage « Confirmations de lecture » (allumé par défaut) ----
alter table profiles add column if not exists read_receipts boolean not null default true;

notify pgrst, 'reload schema';
