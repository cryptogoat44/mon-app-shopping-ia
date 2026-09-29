-- Lot 2 : consentement « statistiques d'usage » (PostHog), facultatif.
-- Chaque choix (accord ou retrait) est un nouvel événement horodaté dans
-- l'historique des consentements : granted_at pour un accord, revoked_at
-- pour un refus ou un retrait. Aucune donnée existante modifiée.
alter type consent_type add value if not exists 'analytics';
