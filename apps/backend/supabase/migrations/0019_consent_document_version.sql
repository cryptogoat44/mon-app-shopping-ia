-- Lot Q, bloc 5 : l'historique des consentements enregistre la VERSION du
-- texte accepté (CGU, politique de confidentialité, déclaration d'âge).
-- Colonne vide pour les consentements donnés avant ce suivi. Nouveau type
-- de consentement : déclaration « Je certifie avoir au moins 15 ans »
-- (décision du fondateur, 2026-09-25). Aucune donnée existante modifiée.
alter table consents add column if not exists document_version text;
alter type consent_type add value if not exists 'age_declaration';
