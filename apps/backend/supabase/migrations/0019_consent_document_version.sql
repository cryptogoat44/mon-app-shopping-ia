-- Lot Q, bloc 5 : l'historique des consentements enregistre la VERSION du
-- document accepté (CGU, politique de confidentialité). Colonne vide pour
-- les consentements donnés avant ce suivi. Aucune donnée existante modifiée.
alter table consents add column if not exists document_version text;
