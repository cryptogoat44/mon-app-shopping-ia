# La liste de contrôle de chaque build envoyé à Apple

*Chantier 8, point 8 de la feuille de route V1. Pour le fondateur. À refaire **à chaque** build envoyé à la validation d'Apple (pas pour un build TestFlight installé par vous seul).*

Copiez cette page dans une note, cochez au fur et à mesure. Chaque ligne dit **où vérifier**. Les commandes se tapent sur le Mac, dans le dossier du projet.

---

## A. Le code du build

- [ ] **Le lecteur intégré est éteint.** Tant que l'accord écrit de TikTok et de Meta manque, aucun build pour Apple ne doit porter le lecteur (point 25 de la feuille de route ; règles 5.2.2, 5.2.3 et 2.5.19).
  Où : `grep -n "LINK_PLAYER_ENABLED" apps/mobile/src/lib/spot-flags.ts` doit ne **rien** afficher, ou afficher `export const LINK_PLAYER_ENABLED = false;`. Et le dossier `apps/mobile/modules/spotto-frame-capture` ne doit **pas** exister : `ls apps/mobile/modules` doit répondre « No such file or directory ».
  Depuis le lot « nettoyage avant le premier build » (10 novembre 2026), c'est le cas : le module natif qui prenait l'image du lecteur et son pont (`player-capture.ts`) sont retirés de l'app, il ne reste aucun code natif de capture, et un test le vérifie à chaque passage (`apps/mobile/tests/player-access.test.ts`). Il ne revient qu'en annulant ce commit, une fois l'accord écrit d'une plateforme reçu (`apps/mobile/BUILD-IPHONE.md`, section 9). Si le dossier existe de nouveau sans cet accord : n'envoyez pas le build.
- [ ] **L'analyse des liens reste coupée** : `apps/mobile/src/lib/spot-flags.ts:7` affiche `LINK_COVER_ENABLED = false`. Sinon, un lien collé partirait chez TikTok ou Meta, et les notes pour Apple seraient fausses.
- [ ] **Le build part de `main`**, vertes sur GitHub (« Types, tests de l'app, compilation » et « Tests serveur hors base ») : https://github.com/cryptogoat44/mon-app-shopping-ia/actions. Notez les 7 caractères du commit : ________
- [ ] **La version** : `apps/mobile/app.json`, champ `"version"` (1.0.0 pour la première ; à augmenter pour un nouveau build natif après la sortie, `apps/mobile/BUILD-IPHONE.md`, section 6).
- [ ] **Le numéro de build** monte tout seul (`apps/mobile/eas.json` : `"appVersionSource": "remote"` et `"autoIncrement": true`). Où : expo.dev → Spotto → **Builds**, ou App Store Connect → TestFlight. Notez-le : ________
- [ ] **Aucune nouvelle autorisation ni nouveau prestataire** depuis le dernier envoi. Sinon : revoir [CONFIDENTIALITE-APPLE.md](CONFIDENTIALITE-APPLE.md), partie 6.

## B. Chez Expo (expo.dev → Spotto → Environment variables, environnement « production »)

- [ ] `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (clé **publique**), `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_WEB_URL` : remplies (`apps/mobile/BUILD-IPHONE.md`, section 2). Le contrôle du début de build arrête un build qui en manque une, ou dont l'adresse n'est pas celle de **spotto-prod** — base de test spotto-dev-2 comprise (`apps/mobile/scripts/verifier-build.js`). Une clé `sb_publishable_…` ne dit pas son projet : vérifiez vous-même qu'elle vient de spotto-prod.
- [ ] `EXPO_PUBLIC_ENVIRONMENT` = `production`.
- [ ] **Les 5 réglages de l'éditeur** `EXPO_PUBLIC_PUBLISHER_NAME`, `_STATUS`, `_ADDRESS`, `_EMAIL`, `_PHONE` : remplis. Sans eux, les pages légales de l'app affichent « [À compléter] » (refus d'Apple, règle 2.1) et « Nous contacter » disparaît (`apps/mobile/src/lib/contact.ts:37`). Le contrôle du début de build ne les vérifie **pas** : regardez vous-même.
- [ ] **Sentry** : `EXPO_PUBLIC_SENTRY_DSN` rempli, `SENTRY_AUTH_TOKEN` en **Secret**, et **pas** de `SENTRY_DISABLE_AUTO_UPLOAD` dans l'environnement production (`apps/mobile/BUILD-IPHONE.md`, section 3).

## C. Chez Render (dashboard.render.com → spotto-api → Environment)

- [ ] **Serveur sans veille** : spotto-api sur une offre payante (pas « Free »). Où : Render → spotto-api → **Settings** → *Instance Type*. Sinon, gardez le paragraphe « SERVER » des notes.
- [ ] **`ANTHROPIC_PHOTO_ENABLED` absent**, ou différent de `true`. Il doit rester coupé en production (`apps/backend/src/env.ts:52-59`, garde `apps/backend/src/lib/aiSwitches.ts:65-68`).
- [ ] **`VOIE_C_ENABLED` et `VOIE_C_AI_ENABLED`** : notez leur valeur : ________ / ________. Seule la valeur exacte `true` allume (`apps/backend/src/env.ts:30-51`). Le paragraphe « OTHER SHOPS » des notes doit dire **ON** ou **OFF** en accord avec `VOIE_C_ENABLED`. La migration 0028 doit être appliquée pour que la voie C tourne (`apps/backend/src/lib/voieC.ts:863-867`).
- [ ] **`ANTHROPIC_API_KEY` présente** si les notes décrivent l'analyse automatique des vidéos. Sans elle, l'app ne la propose pas (`apps/backend/src/routes/videoMoments.ts:107-110`) : retirez alors ce paragraphe des notes.
- [ ] **SerpApi payant et plafonds relevés** (point 5) : offre payante prise chez SerpApi, puis `SERPAPI_DAILY_CAP`, `SERPAPI_MONTHLY_CAP`, `SERPAPI_RENEWAL_DAY` (jour de renouvellement de la nouvelle offre) et `SERPAPI_USER_DAILY_CAP` mis à jour, sans dépasser le quota de l'offre. Valeurs par défaut du code : 25, 225, 3 et 8 (`apps/backend/src/env.ts:17-22`). Attention : voie C allumée, une photo peut coûter **jusqu'à 3** recherches du plafond de tout le service (`apps/backend/src/lib/deadline.ts:36`). Reportez `SERPAPI_USER_DAILY_CAP` et `SERPAPI_DAILY_CAP` dans les crochets `[8]` et `[25]` des notes.
- [ ] **`APP_MIN_IOS_BUILD` absent, ou inférieur ou égal au numéro du build envoyé.** Sinon, le testeur d'Apple verra « Mettez à jour Spotto » à la place de l'app (`apps/mobile/src/lib/app-update.ts:1-8`). Vérification : https://spotto-api.onrender.com/api/app/version doit montrer un minimum vide (`null`) ou ≤ au build.
- [ ] **Sentry du serveur** : `SENTRY_DSN` rempli, `SENTRY_ENVIRONMENT` = `production` (`apps/backend/ALERTES.md`).
- [ ] **Le site** (service mon-app-shopping-ia-web) a les réglages de l'éditeur, dont l'e-mail : la page d'assistance https://mon-app-shopping-ia-web.onrender.com/aide doit montrer l'adresse, déconnecté (Apple : l'adresse d'assistance doit mener à de vraies coordonnées).

## D. La base (Supabase → spotto-prod)

- [ ] **Migrations 0029 et 0030 appliquées** (`apps/backend/supabase/REGISTRE-MIGRATIONS.md`). Sans 0030, le masquage automatique après 3 signalements ne marche pas (`apps/backend/src/lib/autoHide.ts:14-17`) : la phrase des notes « Content reported by 3 different people is hidden automatically » serait fausse.
- [ ] **Un administrateur existe** et voit « Modération » dans Réglages (vous). Il n'est **pas** le compte de démonstration.
- [ ] **Les e-mails de connexion partent** (Authentication → Emails → SMTP) et « Confirm email » est activé : le testeur peut essayer l'inscription.

## E. Le compte de démonstration

Pas de script : chaque pièce du Vault, des Envies ou d'une publication exige une photo, et un script aurait demandé la clé secrète de production sur le Mac. Dans l'app, c'est dix minutes, avec du vrai contenu.

**Le créer (une fois, puis après chaque validation : Apple essaie souvent la suppression du compte)** :
1. Une adresse e-mail que vous lisez, propre à Apple (par exemple un alias de votre messagerie). **Jamais** votre compte administrateur : sa suppression est refusée (`apps/backend/src/routes/account.ts:241`), et Apple essaie la suppression.
2. Dans l'app (build TestFlight), « Commencer » → inscription → confirmer l'e-mail → choisir un nom d'utilisateur.
3. Un mot de passe fort, gardé dans votre gestionnaire de mots de passe. **Jamais** dans ce dépôt, ni dans un e-mail.
4. Du contenu : 2 ou 3 recherches réussies (elles remplissent « Récemment spottées »), 2 ou 3 pièces gardées (Envies), 2 ou 3 pièces dans le Vault, 1 ou 2 publications.
5. Un **second compte**, créé de la même façon (par exemple « spotto_exemple »), avec une publication **publique** et un commentaire. Le compte de démonstration le **suit** : le fil n'affiche que ses propres publications et celles des comptes suivis (`apps/backend/src/routes/posts.ts:377-386`). Le testeur pourra ainsi signaler et bloquer. Chaque signalement du testeur vous enverra une alerte : traitez-le, puis rétablissez le contenu si besoin.

**À chaque envoi :**
- [ ] Le compte se connecte (e-mail confirmé, mot de passe juste, pas suspendu).
- [ ] Il n'est pas administrateur : pas d'entrée « Modération » dans ses Réglages (`apps/mobile/src/app/(app)/settings.tsx:253`).
- [ ] Il a du contenu : Vault, Envies, publications, et il suit le second compte.
- [ ] Il lui reste des recherches : ne l'utilisez pas le jour de l'envoi ; le compteur repart à minuit, heure de Paris.
- [ ] Ses identifiants sont dans les cases « Identifiant » et « Mot de passe » d'App Store Connect, et dans les crochets des notes.

## F. Juste avant de cliquer « Soumettre pour vérification »

- [ ] https://spotto-api.onrender.com/health répond `"status":"ok"`, avec la `version` = le commit noté en A (`apps/backend/src/app.ts:159`, `MISE-EN-LIGNE.md`, section 5).
- [ ] https://spotto-api.onrender.com/health/deep répond `"status":"ok"` : le serveur **et** la base répondent (`apps/backend/src/app.ts:174`).
- [ ] **Sentry** : aucune nouvelle erreur depuis la mise en ligne ; la règle d'alerte « tag alerte » est active et arrive sur votre téléphone (`apps/backend/ALERTES.md`). Les plantages du build sont lisibles (fichiers envoyés par le build : pas d'erreur Sentry dans le journal du build EAS).
- [ ] **Un essai sur votre iPhone, avec ce build** (TestFlight) : connexion avec le compte de démonstration ; une capture d'écran spottée de bout en bout ; Photos → Partager → Spotto ; une vidéo avec l'écran d'accord ; signaler puis bloquer le second compte (puis le débloquer : Réglages → Comptes bloqués) ; suppression d'un compte jetable (jamais le compte de démonstration).
- [ ] **Les notes** ([NOTES-VALIDATION.md](NOTES-VALIDATION.md)) : crochets remplis ; paragraphe « SERVER » retiré si le serveur ne dort plus ; « OTHER SHOPS » sur ON ou OFF selon Render ; la phrase des 24 heures seulement si vous prenez cet engagement.
- [ ] **La fiche** ([FICHE.md](FICHE.md)) et la **déclaration de confidentialité** ([CONFIDENTIALITE-APPLE.md](CONFIDENTIALITE-APPLE.md)) toujours justes.
- [ ] **Les pages légales en ligne** sont les versions définitives (sans bandeau « Projet » ni « [À compléter] ») : https://mon-app-shopping-ia-web.onrender.com/confidentialite et /conditions.
- [ ] **Chiffrement** : rien à déclarer, c'est réglé dans l'app (`apps/mobile/app.json:23`).
