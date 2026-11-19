-- 0050 (lot « découverte », 2026-11-19) : fil « Pour vous » et suggestions de
-- comptes. Un seul réglage, « Proposer mon compte aux autres membres »,
-- allumé par défaut : un membre au compte public peut refuser que ses
-- publications publiques soient proposées dans « Pour vous » et que son compte
-- soit suggéré à des membres qui ne le suivent pas, sans devoir passer en
-- compte privé (droit d'opposition, RGPD, article 21).
--
-- Retour en arrière (après avoir remis un serveur qui ne connaît pas 0050 ;
-- le choix de chaque membre est alors perdu, rien d'autre) :
--   alter table profiles drop column if exists discoverable;
--
-- Ce qu'elle ajoute :
-- 1. profiles.discoverable : vrai (proposé) pour tous au départ, jamais vide.
--    Faux : ni « Pour vous » ni les suggestions ne montrent le compte ni ses
--    publications aux membres qui ne le suivent pas ; ses abonnés le voient
--    comme avant, et son profil reste ouvert à qui le cherche. Effacé avec le
--    profil.
-- Rien d'autre n'est enregistré : aucune trace de ce qui a été vu, aucun
-- profil des centres d'intérêt. Le classement est calculé par le serveur, le
-- même pour tous, à partir des publications, « j'aime », commentaires,
-- abonnements, comptes, suspensions, blocages et signalements déjà là.
--
-- Facultative pour le serveur : sans elle, tous les comptes publics sont
-- proposés, le réglage est caché dans l'app et sa route répond
-- « indisponible » (sonde du schéma, lib/forYou.ts) ; le fil « Pour vous »
-- fonctionne. Aucune exigence au-delà de ce qui est déjà en production : la
-- table des profils (0001), vérifiée ci-dessous avant tout changement. D'abord
-- sur spotto-dev-2 (migrer-dev), puis sur spotto-prod. Indépendante de 0045 à
-- 0049. Rejouable sans effet (if not exists) ; ne supprime ni ne modifie
-- aucune donnée existante (une colonne ajoutée avec sa valeur par défaut).
-- Aucune règle d'accès nouvelle : profiles garde sa RLS active sans politique,
-- seul le serveur, avec sa clé secrète, la lit et l'écrit.
-- Aucun déclencheur, aucune fonction, aucun index.

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'profiles') then
    raise exception '0050 demande la table des profils (migration 0001) : appliquez d''abord les migrations précédentes, puis relancez 0050.';
  end if;
end;
$$;

-- ---- Proposer mon compte aux autres membres ----
alter table profiles add column if not exists discoverable boolean not null default true;

notify pgrst, 'reload schema';
