# En-têtes de sécurité du site (à coller dans Render)

Lot garde-fous, point 19 de la feuille de route V1. Ces consignes disent au
navigateur d'où le code du site peut venir, d'interdire d'afficher le site
dans le cadre d'un autre site, d'utiliser toujours HTTPS, etc. Elles limitent
les dégâts si un contenu piégé arrivait un jour dans une page.

La source est `apps/mobile/web-headers.ts` ; un test vérifie que cette page
dit exactement la même chose. Vérifié avant de l'écrire : le site exporté,
ouvert dans Chrome avec ces en-têtes, s'affiche sans aucun refus sur ses pages
publiques (accueil, connexion, inscription, conditions, confidentialité, mot
de passe oublié), et un script injecté dans la page est bien refusé.

## Où les coller

1. Ouvrez le tableau de bord de Render, puis le **site** (le service statique
   `mon-app-shopping-ia-web`, pas le serveur `spotto-api`).
2. Menu **Settings** → section **Headers** → **Add Header**, une fois par ligne
   du tableau ci-dessous, avec **Path** = `/*`.
3. Enregistrez. Render remet le site en ligne de lui-même.
4. Dites-le à Claude : il vérifiera le site en ligne (connexion, Spotter,
   images des boutiques, vidéo). En cas de souci, retirer la ligne
   `Content-Security-Policy` remet tout comme avant.

| Name | Value |
| --- | --- |
| `Content-Security-Policy` | `default-src 'self'; script-src 'self' 'sha256-67fhrP0+BkBqmgGGXTtgiVO/9EQs3QruYNU/7fnRkI8='; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: data:; font-src 'self' data:; connect-src 'self' https://spotto-api.onrender.com https://selhqdqfrflsqivgxypf.supabase.co wss://selhqdqfrflsqivgxypf.supabase.co https://*.ingest.de.sentry.io https://eu.i.posthog.com blob: data:; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests` |
| `Strict-Transport-Security` | `max-age=31536000` |
| `X-Content-Type-Options` | `nosniff` |
| `X-Frame-Options` | `DENY` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(self), microphone=(), geolocation=(), payment=(), usb=()` |

## Quand les changer

- L'adresse du serveur ou de la base change (nouveau nom de domaine, autre
  projet Supabase) : la ligne `connect-src` doit suivre. Demandez à Claude de
  régénérer ce tableau.
- Le lecteur intégré TikTok et Instagram est allumé : il faudra ajouter
  `frame-src https://www.tiktok.com https://www.instagram.com` (Claude le fera
  avec ce lot).
- Une mise à jour d'Expo change le petit script écrit dans chaque page : le
  test le repère (empreinte `sha256-…`), Claude met la valeur à jour.
