# App iPhone : builds, réglages et corrections après la sortie

Lot « app iPhone prête pour son premier build publié » (chantier 4). Les
commandes `eas …` se tapent sur le Mac, dans le dossier `apps/mobile`.

## 1. Une seule fois : relier le projet à Expo (EAS)

1. `eas login`, puis `eas init` : écrit l'identifiant du projet dans `app.json`.
2. `eas update:configure` : ajoute dans `app.json` l'adresse des mises à jour
   à distance (`updates.url`). Les canaux sont déjà dans `eas.json`.
3. Donner ces deux changements de `app.json` à Claude, qui les enregistre.

Tant que l'étape 2 n'est pas faite, l'app fonctionne normalement, sans mise à
jour à distance.

## 2. Les réglages à saisir chez Expo

Aucune adresse ni clé n'est écrite dans `eas.json` : elles viennent des
« variables d'environnement » d'Expo, comme le recommande Expo, car ce sont
les seules que lisent aussi les mises à jour à distance (`eas update`).

Où : expo.dev → projet Spotto → **Environment variables** → **Add variable**.
Pour chacune : le nom, la valeur, la visibilité, et les environnements cochés.

| Nom | Valeur | Visibilité | Environnements |
| --- | --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | `https://selhqdqfrflsqivgxypf.supabase.co` (spotto-prod ; à vérifier dans Supabase → Project Settings) | Plain text | preview, production |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | clé **publique** de spotto-prod : Supabase → Project Settings → API Keys → « Publishable key » (`sb_publishable_…`). **Jamais** la « Secret key ». | Plain text | preview, production |
| `EXPO_PUBLIC_API_URL` | `https://spotto-api.onrender.com` | Plain text | preview, production |
| `EXPO_PUBLIC_WEB_URL` | `https://mon-app-shopping-ia-web.onrender.com` (ou le futur nom de domaine) | Plain text | preview, production |
| `EXPO_PUBLIC_SENTRY_DSN` | `https://c46ffc0abf2f3dc09449cf8764fde463@o4512173730299904.ingest.de.sentry.io/4512173801996368` | Plain text | preview, production |
| `EXPO_PUBLIC_POSTHOG_KEY` | `phc_moDi25bk7iMpzHCLhp4LZYWa5n4CgL9RUMeTjkUTg53c` | Plain text | preview, production |
| `EXPO_PUBLIC_TURNSTILE_SITE_KEY` | clé **publique** (« Site Key ») du widget anti-robots Cloudflare Turnstile, la même que sur Render pour le site (`ANTI-ROBOTS.md`). **Jamais** la « Secret Key ». | Plain text | preview, production |
| `EXPO_PUBLIC_ENVIRONMENT` | `beta` | Plain text | preview seulement |
| `EXPO_PUBLIC_ENVIRONMENT` | `production` | Plain text | production seulement |
| `EXPO_PUBLIC_PUBLISHER_NAME`, `_STATUS`, `_ADDRESS`, `_EMAIL`, `_PHONE` | l'identité de l'éditeur, comme sur Render (pages légales et « Nous contacter ») | Plain text | preview, production |
| `SENTRY_AUTH_TOKEN` | le jeton Sentry (section 3) | **Secret** | preview, production |

Les valeurs Sentry, PostHog et des adresses sont celles qui figuraient jusqu'ici
dans `eas.json` : les comparer avec celles du site sur Render.

En ligne de commande, la même chose, par exemple :
`eas env:set --name EXPO_PUBLIC_API_URL --value https://spotto-api.onrender.com --environment preview --environment production --visibility plaintext`

**Une seule base pour Apple : spotto-prod.** Les builds `preview` (TestFlight)
et `production` (App Store) visent tous les deux spotto-prod, jamais une autre
base. La base de test (spotto-dev-2) ne sert qu'au profil `development`
(section 4) et aux tests.

**Filet de sécurité.** Au début de chaque build `preview` ou `production`, un
contrôle (`scripts/verifier-build.js`) arrête le build en une minute, avec un
message en français :

- si une adresse ou la clé publique manque ;
- si `EXPO_PUBLIC_SUPABASE_URL` n'est pas exactement l'adresse de spotto-prod :
  le message dit si c'est la base de test (spotto-dev-2), l'ancien projet
  Supabase ou une autre base ;
- si `EXPO_PUBLIC_SUPABASE_ANON_KEY` est une ancienne clé « anon » (longue, qui
  commence par `eyJ`) d'un autre projet que spotto-prod ;
- si une clé **secrète** a été collée à la place de la clé publique (Supabase
  ou widget anti-robots) ;
- si le jeton Sentry manque.

Limite : une clé `sb_publishable_…` ne dit pas à quel projet elle appartient,
le contrôle ne peut donc pas la vérifier. Copiez-la bien depuis **spotto-prod**
(Supabase → spotto-prod → Project Settings → API Keys) ; avec la clé d'une
autre base, personne ne pourrait se connecter dans le build.

Le contrôle n'affiche jamais une valeur, seulement le nom du réglage. Sans
`EXPO_PUBLIC_TURNSTILE_SITE_KEY`, il prévient seulement : ce build n'aurait pas
la protection anti-robots (`ANTI-ROBOTS.md`).

## 3. Le jeton Sentry (plantages lisibles)

Sentry → Settings → Developer Settings → **Organization Tokens** → Create New
Token (nom : « EAS Spotto »). Le jeton commence par `sntrys_`. Le saisir chez
Expo sous `SENTRY_AUTH_TOKEN`, visibilité **Secret**, environnements preview et
production. Chaque build envoie alors à Sentry les fichiers qui rendent les
plantages lisibles (sourcemaps et dSYM). L'organisation Sentry vient de ce
jeton : le message « Missing config for organization » d'Expo est normal.

Pour un tout premier build d'essai sans ce jeton : créer plutôt
`SENTRY_DISABLE_AUTO_UPLOAD` = `true` dans l'environnement **preview** (et le
retirer ensuite). Jamais en production.

## 4. Essayer l'app sur votre iPhone (profil « development »)

1. `eas device:create`, ouvrir le lien sur l'iPhone et installer le profil.
2. Sur l'iPhone : Réglages → Confidentialité et sécurité → **Mode développeur**.
3. `eas build --profile development --platform ios`, puis installer le build
   depuis le lien ou le QR code.
4. Sur le Mac : `pnpm --filter mobile start` ; ouvrir Spotto sur l'iPhone
   (même Wi-Fi). Le code vient du Mac et de son fichier `apps/mobile/.env`.

Simulateur du Mac : `eas build --profile development-simulator --platform ios`.

## 5. TestFlight et App Store

- TestFlight : `eas build --profile preview --platform ios`, puis
  `eas submit --profile preview --platform ios`.
- App Store : la même chose avec `--profile production`.

Le numéro de build augmente tout seul à chaque build (réglé chez EAS).

Avant chaque envoi à Apple : la liste de contrôle, la fiche, les notes de
validation et les réponses « App Privacy » sont dans
[app-store/](app-store/README.md).

## 6. Corriger l'app après sa sortie

- **Correction du code de l'app** (textes, écrans, logique) sans repasser par
  Apple : `eas update --channel production --environment production --message "…"`.
  Les iPhone la reçoivent au lancement suivant. Pour que Sentry lise aussi ses
  plantages : `npx sentry-expo-upload-sourcemaps dist` juste après.
- **Changement natif** (nouveau module, nouvelle autorisation, `app.json`) : un
  nouveau build, en augmentant `version` dans `app.json` (1.0.0 → 1.0.1) ; les
  mises à jour à distance ne visent que les builds de la même version.
- **Obliger une mise à jour** : chez Render → spotto-api → Environment,
  `APP_MIN_IOS_BUILD` = le plus petit numéro de build encore accepté (voir
  App Store Connect ou EAS → Builds), et `APP_STORE_URL` = l'adresse de la fiche
  (`https://apps.apple.com/…`). Les iPhone plus anciens affichent « Mettez à
  jour Spotto ». Pour arrêter : supprimer `APP_MIN_IOS_BUILD`. Ne jamais
  dépasser le build disponible sur l'App Store.

## 7. « Partager vers Spotto »

Si iOS ne rouvre pas Spotto après un partage, le partage n'est plus perdu :
il s'ouvre quand on ouvre Spotto à la main (dans les 24 heures).

Plan B si Apple refuse l'extension : retirer de `app.json` les deux entrées
`expo-share-intent` et `./plugins/extension-partage.js`, puis refaire un build
(à vérifier par ce build).

## 8. Notifications des nouveaux messages (coupées par défaut)

Spotto peut prévenir un membre sur son iPhone quand quelqu'un lui écrit
(« Nouveau message de @pseudo », jamais le texte du message). Tout est prêt
dans le code, mais **coupé** : tant que `PUSH_ENABLED` ne vaut pas `true` chez
Render, rien n'est envoyé et l'app ne demande jamais l'autorisation. Les
notifications passent par le service d'Expo, gratuit et sans clé à saisir.

Pour les allumer, dans cet ordre :

1. **Le projet relié à Expo** (section 1, `eas init`) : sans l'identifiant du
   projet dans `app.json`, l'app ne propose pas les notifications.
2. **La clé de notifications d'Apple, chez EAS.** Au prochain
   `eas build --profile preview --platform ios`, EAS propose de configurer les
   notifications (« Would you like to set up Push Notifications for your
   project? », libellé à vérifier) : répondre **oui**. EAS crée alors la clé
   de notifications d'Apple (« Apple Push Notifications service key ») dans
   votre compte Apple Developer et la garde pour vous. Autre chemin :
   `eas credentials` → iOS → le profil → « Push Notifications: Manage your
   Apple Push Notifications Key » → « Set up a new key » (libellés à
   vérifier). Pour contrôler : expo.dev → projet Spotto → **Credentials** →
   iOS : une clé de notifications y figure (à vérifier).
3. **Un nouveau build iPhone** (le module des notifications est natif) : une
   mise à jour à distance ne suffit pas. Si un build est déjà sur l'App Store
   ou TestFlight, augmenter d'abord `version` dans `app.json` (section 6). Un
   ancien build qui reçoit le nouveau code n'a simplement pas les
   notifications : rien ne plante.
4. **La migration 0035** : d'abord sur spotto-dev-2 (`pnpm --filter backend
   migrer-dev supabase/migrations/0035_notifications_telephone.sql --verifier
   supabase/verifications/0035-verification.sql`), puis sur spotto-prod, dans
   l'éditeur SQL de Supabase ; vérifier avec
   `supabase/verifications/0035-verification.sql` (une ligne, tout à `true`),
   puis noter la date dans `apps/backend/supabase/REGISTRE-MIGRATIONS.md`.
5. **L'interrupteur** : Render → spotto-api → Environment → ajouter
   `PUSH_ENABLED` = `true` (exactement, en minuscules), puis enregistrer
   (le serveur redémarre). Pour couper : supprimer la variable.
   `EXPO_ACCESS_TOKEN` ne sert que si la « sécurité renforcée des
   notifications » est activée dans le compte Expo (à vérifier) ; sinon, ne
   rien ajouter.

Ensuite, sur un iPhone avec le nouveau build : ouvrir une conversation où
l'on a reçu un message (ou en envoyer un) ; la feuille « Être prévenu de vos
nouveaux messages ? » s'affiche une fois, puis la fenêtre d'iOS. Le réglage
est aussi dans Réglages → « Notifications de messages ». Un message envoyé
depuis un autre compte fait arriver la notification ; la toucher ouvre la
conversation.

Avant d'allumer : faire relire le paragraphe « Expo » de la politique de
confidentialité (« [À vérifier] ») et revoir les réponses « App Privacy »
d'Apple (`app-store/CONFIDENTIALITE-APPLE.md`).
