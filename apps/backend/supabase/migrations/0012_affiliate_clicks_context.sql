-- Option B retenue pour l'IP (voir docs/journal-decisions.md) : on ne
-- stocke plus du tout l'IP, même hachée — les métriques d'affiliation
-- n'en ont pas besoin, et moins on garde de données personnelles, mieux
-- c'est. En échange, on ajoute le contexte d'ouverture du lien (depuis
-- quel écran l'utilisateur a cliqué), utile pour comprendre l'usage réel
-- sans identifier personne.
alter table affiliate_clicks drop column if exists ip_hash;

alter table affiliate_clicks add column if not exists context text
  check (context is null or context in ('result', 'similar', 'vault', 'wishlist', 'post', 'price_alert'));
