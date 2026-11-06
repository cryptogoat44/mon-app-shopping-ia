# Installer et lancer Spotto

*Réécrit au lot « filets de sécurité » (point 24 de la feuille de route V1). L'ancienne version décrivait l'ancien projet. Surtout, elle affirmait que Render republie tout seul à chaque envoi sur `main`. **C'est faux** : rien ne part en ligne sans un clic. Pour mettre en ligne, voir [MISE-EN-LIGNE.md](MISE-EN-LIGNE.md).*

## Le projet

| Dossier | Ce que c'est |
|---|---|
| `apps/backend` | Le serveur (Fastify). Lui seul parle à Supabase, SerpApi et Anthropic. |
| `apps/mobile` | L'app (Expo) : elle sert à la fois l'iPhone et le site web. |
| `packages/shared-types` | Ce que le serveur et l'app partagent. |

Deux bases Supabase :
- **spotto-prod** (`selhqdqfrflsqivgxypf`) : la production, les vrais utilisateurs. Jamais pour développer ni pour les tests.
- **spotto-dev-2** (`sedfepcpmhilaxbrgdif`) : le développement et les tests.

## 1. Les outils (une fois)

- **Node.js 26** : la version exacte est dans `.node-version` (26.8.2). https://nodejs.org
- **pnpm 11.25.0** : `npm install -g pnpm@11.25.0`
- **Git**.
- **Google Chrome** : un test du serveur et les parcours à l'écran l'utilisent.
- Pour l'iPhone : Xcode et l'outil `eas`, voir [apps/mobile/BUILD-IPHONE.md](apps/mobile/BUILD-IPHONE.md).

## 2. Installer

```bash
git clone https://github.com/cryptogoat44/mon-app-shopping-ia.git
cd mon-app-shopping-ia
pnpm install --frozen-lockfile
```

## 3. Les réglages (variables d'environnement)

Les fichiers `.env` restent sur votre ordinateur : Git ne les envoie jamais. **Le dépôt est public** : n'y écrivez jamais une vraie clé, ni une adresse e-mail ou postale personnelle.

Le plus simple, pour travailler sur spotto-dev-2 : `pnpm --filter backend configurer-env-dev`. Cette commande remplit les deux fichiers `.env` ci-dessous. Elle demande la clé publique, en saisie masquée.

### Le serveur : `apps/backend/.env`

`cp apps/backend/.env.example apps/backend/.env`, puis remplissez. **Chaque variable est expliquée dans [apps/backend/.env.example](apps/backend/.env.example)**. Au démarrage, le serveur vérifie les obligatoires et s'arrête avec un message clair s'il en manque une.

| Variable | Obligatoire | Rôle |
|---|---|---|
| `SUPABASE_URL` | oui | Adresse du projet Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | oui | Clé **secrète** de Supabase (serveur seulement, jamais dans l'app) |
| `SERPAPI_KEY` | oui | Clé SerpApi (recherche par image). Chaque vraie recherche coûte un crédit. |
| `SUPABASE_ANON_KEY` | pour les tests | Clé publique, utilisée par les tests seulement |
| `PORT` | non (3000) | Port local du serveur |
| `SERPAPI_DAILY_CAP`, `SERPAPI_MONTHLY_CAP`, `SERPAPI_RENEWAL_DAY`, `SERPAPI_USER_DAILY_CAP` | non | Plafonds des recherches (25 par jour, 225 par cycle, renouvellement le 3, 8 par personne et par jour) |
| `ANTHROPIC_API_KEY` | non | IA (analyse des vidéos, voie C) ; absente, ces fonctions se coupent |
| `VOIE_C_ENABLED`, `VOIE_C_AI_ENABLED`, `ANTHROPIC_PHOTO_ENABLED` | non | Interrupteurs de la voie C, coupés sauf valeur exacte `true` |
| `SENTRY_DSN`, `SENTRY_ENVIRONMENT` | non | Suivi des erreurs et alertes (`production` sur Render) |
| `APP_MIN_IOS_BUILD`, `APP_STORE_URL` | non | Mise à jour obligatoire de l'app iPhone |
| `META_OEMBED_ACCESS_TOKEN` | non | Reconnaissance des liens Instagram |
| `RENDER_GIT_COMMIT` | jamais à la main | Remplie par Render : la version donnée par /health |

Pour la copie hebdomadaire des photos seulement (tâche planifiée de Render) : `PHOTO_BACKUP_S3_ENDPOINT`, `PHOTO_BACKUP_S3_REGION`, `PHOTO_BACKUP_S3_BUCKET`, `PHOTO_BACKUP_S3_ACCESS_KEY_ID`, `PHOTO_BACKUP_S3_SECRET_ACCESS_KEY` (voir [apps/backend/supabase/SAUVEGARDE-PHOTOS.md](apps/backend/supabase/SAUVEGARDE-PHOTOS.md)).

Pour les outils du Mac seulement : `DEV_DATABASE_URL` (migrations sur spotto-dev-2, enregistrée par `pnpm --filter backend configurer-base-dev`) et le fichier `apps/backend/.render-api-key` (commande `render-bride`).

### L'app et le site : `apps/mobile/.env`

`cp apps/mobile/.env.example apps/mobile/.env`, puis remplissez :
- `EXPO_PUBLIC_SUPABASE_URL` et `EXPO_PUBLIC_SUPABASE_ANON_KEY` : l'adresse et la clé **publique** (« publishable ») du même projet Supabase que le serveur ;
- `EXPO_PUBLIC_API_URL` : `http://localhost:3000`. Sur un téléphone, mettez l'adresse IP locale du Mac à la place de `localhost` ;
- facultatives : `EXPO_PUBLIC_WEB_URL`, `EXPO_PUBLIC_SENTRY_DSN`, `EXPO_PUBLIC_POSTHOG_KEY`, `EXPO_PUBLIC_ENVIRONMENT`, `EXPO_PUBLIC_TURNSTILE_SITE_KEY` (protection anti-robots, voir apps/mobile/ANTI-ROBOTS.md), et l'identité de l'éditeur `EXPO_PUBLIC_PUBLISHER_NAME`, `_STATUS`, `_ADDRESS`, `_EMAIL`, `_PHONE` (jamais dans le dépôt).

### Les valeurs de production

Elles ne sont que chez les services : chez Render pour le serveur et le site (service → **Environment**), chez Expo pour les builds iPhone (voir BUILD-IPHONE.md, section 2).

## 4. Lancer

Deux terminaux, à la racine du projet :

```bash
pnpm backend:dev     # le serveur, sur http://localhost:3000
pnpm mobile:start    # l'app : touche « w » pour le site dans le navigateur
```

Pour l'app sur votre iPhone, il faut un build de développement : voir BUILD-IPHONE.md, section 4.

## 5. Les tests

| Commande | Ce qu'elle vérifie |
|---|---|
| `pnpm --filter backend test:hors-base` | Les tests du serveur qui n'ont besoin ni de la base ni d'une clé (comme sur GitHub) |
| `pnpm --filter backend test:ci` | Tous les tests du serveur, sur spotto-dev-2 (Mac seulement : ils créent et effacent des comptes de test) |
| `pnpm --filter backend typecheck` | Les types du serveur |
| `pnpm --filter mobile test` | Les tests de l'app |
| `pnpm --filter backend migrer-dev supabase/migrations/00XX_….sql` | Applique une migration sur spotto-dev-2, jamais ailleurs |

À chaque envoi sur GitHub, trois vérifications tournent (onglet **Actions**) : « Types, tests de l'app, compilation », « Tests serveur hors base », et « Tests serveur (spotto-dev-2) ». Cette dernière reste rouge tant que ses deux secrets manquent. Juste avant le lancement : GitHub → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**, pour `SPOTTO_DEV_SERVICE_ROLE_KEY` et `SPOTTO_DEV_PUBLISHABLE_KEY` (les clés de spotto-dev-2, jamais celles de la production).

## 6. Où trouver chaque mode d'emploi

| Fichier | Pour quoi |
|---|---|
| [MISE-EN-LIGNE.md](MISE-EN-LIGNE.md) | Mettre en ligne, vérifier la version, revenir en arrière, carnet d'incidents |
| [apps/backend/supabase/REGISTRE-MIGRATIONS.md](apps/backend/supabase/REGISTRE-MIGRATIONS.md) | Chaque migration et son état en production |
| [apps/backend/.env.example](apps/backend/.env.example) | Chaque réglage du serveur, expliqué |
| [apps/backend/ALERTES.md](apps/backend/ALERTES.md) | Les alertes envoyées à Sentry, où les recevoir, la sonde extérieure |
| [apps/mobile/BUILD-IPHONE.md](apps/mobile/BUILD-IPHONE.md) | Builds iPhone, réglages chez Expo, TestFlight, corrections après la sortie |
| [apps/backend/supabase/emails/REGLAGES-SUPABASE.md](apps/backend/supabase/emails/REGLAGES-SUPABASE.md) | E-mails de connexion et réglages de Supabase |
| [apps/mobile/EN-TETES-SITE.md](apps/mobile/EN-TETES-SITE.md) | En-têtes de sécurité du site, à coller dans Render |
| [apps/backend/supabase/SAUVEGARDE-PHOTOS.md](apps/backend/supabase/SAUVEGARDE-PHOTOS.md) | La copie hebdomadaire des photos, et leur restauration |
| `apps/backend/supabase/mise-en-ligne/` | Les fichiers SQL de mise en production déjà utilisés (lot 5, voie C) |
| [apps/backend/tests/fixtures/serpapi/LISEZ-MOI.md](apps/backend/tests/fixtures/serpapi/LISEZ-MOI.md) | Les réponses SerpApi enregistrées, rejouées par les tests |
| `docs/` (sur votre Mac seulement) | Scripts de retour en arrière, nommer un administrateur, notes. Jamais envoyé sur GitHub : à sauvegarder en privé. |
