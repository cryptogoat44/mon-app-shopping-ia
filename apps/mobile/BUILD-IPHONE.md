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
- si le jeton Sentry manque ;
- pour un build `production` (App Store) seulement, s'il resterait un **texte
  provisoire** à l'écran, ce qu'Apple refuse (règle 2.1 : « placeholder
  text […] should be scrubbed before submission ») :
  - un des cinq réglages de l'éditeur `EXPO_PUBLIC_PUBLISHER_NAME`, `_STATUS`,
    `_ADDRESS`, `_EMAIL`, `_PHONE` manque (ou contient encore un texte entre
    crochets) : les pages légales afficheraient « [À compléter : …] » ;
  - un passage entre crochets « [À compléter », « [À vérifier », « [À décider »
    (ou en anglais « [To be completed », « [To be verified », « [To be
    decided ») reste dans les textes légaux, `apps/mobile/src/legal`. Le
    message donne la liste des fichiers concernés et le nombre de passages.

  Pour un build `preview` (TestFlight), ces deux constats ne sont que des
  avertissements : le build continue, pour que vous puissiez essayer l'app
  avant que les textes soient validés. **Aujourd'hui, les textes légaux
  contiennent encore de tels passages : un build `production` sera donc
  arrêté tant que votre avocat ne les a pas validés et que les crochets
  n'ont pas été retirés.** C'est voulu.

Limite : une clé `sb_publishable_…` ne dit pas à quel projet elle appartient,
le contrôle ne peut donc pas la vérifier. Copiez-la bien depuis **spotto-prod**
(Supabase → spotto-prod → Project Settings → API Keys) ; avec la clé d'une
autre base, personne ne pourrait se connecter dans le build.

Autre limite : le contrôle lit les textes légaux, pas le reste de l'app. Le
bandeau « Projet — à faire valider par un professionnel » des pages légales
(affiché tant que leur version commence par « projet- ») et les pages du site
en ligne restent à vérifier à la main (`app-store/CONTROLE-BUILD.md`).

Le contrôle n'affiche jamais une valeur, seulement le nom du réglage ou du
fichier. Sans
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

- **Correction du code de l'app, à distance** (`expo-updates`), sans repasser
  par Apple : `eas update --channel production --environment production --message "…"`.
  Les iPhone la reçoivent au lancement suivant. Pour que Sentry lise aussi ses
  plantages : `npx sentry-expo-upload-sourcemaps dist` juste après.

  **À n'utiliser que pour corriger, jamais pour ajouter.** La règle 2.5.2
  d'Apple dit : « Apps should be self-contained in their bundles, and may not
  read or write data outside the designated container area, nor may they
  download, install, or execute code which introduces or changes features or
  functionality of the app, including other apps. » (une app ne télécharge
  pas de code qui ajoute ou change ses fonctions). Une mise à jour à distance
  est justement du code téléchargé après la validation. La lecture prudente,
  à suivre tant que vous n'avez pas décidé autre chose avec votre avocat :

  | Permis par une mise à jour à distance | Jamais par une mise à jour à distance : nouveau build, revu par Apple |
  | --- | --- |
  | une panne, un plantage, un calcul faux | une fonction nouvelle, un nouvel écran, un nouvel onglet |
  | une faute dans un texte, une traduction, un libellé | une fonction coupée qu'on rallume : basculer une constante figée (`apps/mobile/src/lib/spot-flags.ts`, l'alerte « Épuisé »), remettre le lecteur |
  | un défaut d'affichage ou d'accessibilité | un changement de ce à quoi sert l'app, de son modèle économique, ou des données qu'elle collecte |
  | un réglage de sécurité | un nouveau prestataire, une nouvelle autorisation (impossible de toute façon : c'est du natif) |

  Deux conséquences pratiques :
  - **les interrupteurs du serveur** (`PUSH_ENABLED`, `VOIE_C_ENABLED`,
    `VOIE_C_AI_ENABLED`, `LINK_PREVIEW_ENABLED`, `ANTHROPIC_PHOTO_ENABLED`)
    suivent la même prudence, au titre de la règle 2.5.19 (aucune fonction
    cachée, dormante ou non décrite) : ce qui est allumé le jour de l'envoi
    est décrit comme allumé dans les notes pour Apple ; allumer plus tard une
    fonction qu'Apple a vue coupée passe par une nouvelle version et de
    nouvelles notes (`app-store/NOTES-VALIDATION.md`) ;
  - **en cas de doute, faites un nouveau build.** Un refus d'Apple coûte
    quelques jours ; une app retirée pour avoir changé après sa validation
    coûte bien plus.

  Cette règle d'usage est une décision qui vous appartient (rapport d'audit,
  partie 2, décision 5 : réserver les mises à jour à distance aux corrections,
  ou retirer `expo-updates` de la première version). Le contrat de licence du
  programme développeur d'Apple, qui encadre aussi ce point, n'a pas été lu :
  à voir avec votre avocat à l'inscription.
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

## 9. Lecteur intégré TikTok / Instagram : hors du build

Le lecteur intégré (lot « lecteur intégré ») ouvrait une vidéo TikTok ou
Instagram dans Spotto, et « Spotter ce moment » en prenait l'image grâce à un
module natif écrit en Swift (`apps/mobile/modules/spotto-frame-capture`).
Aucune plateforme n'a autorisé cet usage par écrit, et Apple refuse les
fonctions cachées ou dormantes (règle 2.5.19) comme l'usage non autorisé du
contenu d'un autre service (règle 5.2.3).

Depuis le lot « nettoyage avant le premier build » (10 novembre 2026) :

- le module natif de capture et son pont (`src/lib/player-capture.ts`) sont
  **retirés** de l'app : un build iPhone ne contient plus aucun code natif de
  capture, le dossier `apps/mobile/modules` n'existe plus ;
- le lecteur n'est proposé nulle part (`LINK_PLAYER_ENABLED = false`, et de
  toute façon jamais sans le module : `src/lib/player-access.ts`) ; un lien
  collé ou partagé affiche l'aide « capture d'écran d'abord », comme avant ;
- le reste du code du lecteur (lecture de la vidéo, accord préalable) reste
  dans le dépôt, éteint, sans « Spotter ce moment ».

**Pour le faire revenir**, seulement après l'accord écrit d'une plateforme :
demander à Claude d'annuler le commit de ce lot (`git revert` du commit
« App iPhone : module natif de capture du lecteur retiré »), puis de passer
`LINK_PLAYER_ENABLED` à `true`, puis refaire un build iPhone (le module est
natif : une mise à jour à distance ne suffit pas). Il faudra alors revoir les
notes pour Apple et les réponses « App Privacy » (`app-store/`).
