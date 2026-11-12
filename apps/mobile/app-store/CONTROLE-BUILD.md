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
- [ ] **Les 5 réglages de l'éditeur** `EXPO_PUBLIC_PUBLISHER_NAME`, `_STATUS`, `_ADDRESS`, `_EMAIL`, `_PHONE` : remplis. Sans eux, les pages légales de l'app affichent « [À compléter] » (refus d'Apple, règle 2.1) et « Nous contacter » disparaît (`apps/mobile/src/lib/contact.ts:37`). Depuis le lot « conformité Apple », le contrôle du début de build **arrête** un build `production` où l'un des cinq manque, et le nomme (pour `preview`, il prévient seulement). Il ne juge pas le contenu : relisez vous-même les cinq valeurs.
- [ ] **Plus aucun passage entre crochets dans les textes légaux** (`apps/mobile/src/legal`) : « [À compléter », « [À vérifier », « [À décider » et leurs équivalents anglais. Le même contrôle **arrête** un build `production` s'il en reste un, avec la liste des fichiers (`apps/mobile/scripts/verifier-build.js`). Pour savoir où vous en êtes sans lancer de build : `cd apps/mobile && EAS_BUILD_PROFILE=preview node scripts/verifier-build.js` (lisez la ligne « Textes légaux inachevés » ; il se plaint aussi des réglages absents de votre Mac, c'est normal : ils ne sont saisis que chez Expo). Ce contrôle ne voit ni le bandeau « Projet » des pages légales, ni les pages du site en ligne : voir la partie F.
- [ ] **Sentry** : `EXPO_PUBLIC_SENTRY_DSN` rempli, `SENTRY_AUTH_TOKEN` en **Secret**, et **pas** de `SENTRY_DISABLE_AUTO_UPLOAD` dans l'environnement production (`apps/mobile/BUILD-IPHONE.md`, section 3).

## C. Chez Render (dashboard.render.com → spotto-api → Environment)

- [ ] **Serveur sans veille** : spotto-api sur une offre payante (pas « Free »). Où : Render → spotto-api → **Settings** → *Instance Type*. Sinon, gardez le paragraphe « SERVER » des notes.
- [ ] **`ANTHROPIC_PHOTO_ENABLED` absent**, ou différent de `true`. Il doit rester coupé en production (`apps/backend/src/env.ts:52-59`, garde `apps/backend/src/lib/aiSwitches.ts:65-68`).
- [ ] **`VOIE_C_ENABLED` et `VOIE_C_AI_ENABLED`** : notez leur valeur : ________ / ________. Seule la valeur exacte `true` allume (`apps/backend/src/env.ts:30-51`). Le paragraphe « OTHER SHOPS » des notes doit dire **ON** ou **OFF** en accord avec `VOIE_C_ENABLED`. La migration 0028 doit être appliquée pour que la voie C tourne (`apps/backend/src/lib/voieC.ts:863-867`).
- [ ] **`PUSH_ENABLED`** (notifications sur l'iPhone) : notez sa valeur : ________. Seule la valeur exacte `true` allume (`apps/backend/src/env.ts:82`). Les notes pour Apple doivent dire **ON** ou **OFF** en accord (règle 2.5.19 : aucune fonction dormante non décrite).
  **Allumé** : il faut les migrations 0035 (et 0036 pour les alertes) en production, la clé de notifications d'Apple (`apps/mobile/BUILD-IPHONE.md`), et un essai de bout en bout sur le build (partie F). **Coupé** : l'app ne demande jamais l'autorisation ; mais une personne qui allume la cloche d'une envie lit « les notifications seront bientôt disponibles », ce qu'Apple refuse (règles 2.1 et 2.2) : voir [NOTES-VALIDATION.md](NOTES-VALIDATION.md), partie 1, point 9, avant d'envoyer.
- [ ] **`LINK_PREVIEW_ENABLED` absent**, ou différent de `true` (`apps/backend/src/env.ts:37`). Il doit rester coupé tant que l'accord écrit de TikTok ou de Meta manque : allumé, le serveur leur demanderait l'aperçu d'un lien, et les notes pour Apple (« OFF ») seraient fausses.
- [ ] **`ANTHROPIC_API_KEY` présente** si les notes décrivent l'analyse automatique des vidéos. Sans elle, l'app ne la propose pas (`apps/backend/src/routes/videoMoments.ts:107-110`) : retirez alors ce paragraphe des notes.
- [ ] **SerpApi payant et plafonds relevés** (point 5) : offre payante prise chez SerpApi, puis `SERPAPI_DAILY_CAP`, `SERPAPI_MONTHLY_CAP`, `SERPAPI_RENEWAL_DAY` (jour de renouvellement de la nouvelle offre) et `SERPAPI_USER_DAILY_CAP` mis à jour, sans dépasser le quota de l'offre. Valeurs par défaut du code : 25, 225, 3 et 8 (`apps/backend/src/env.ts:17-22`). Attention : voie C allumée, une photo peut coûter **jusqu'à 3** recherches du plafond de tout le service (`apps/backend/src/lib/deadline.ts:36`). Reportez `SERPAPI_USER_DAILY_CAP` et `SERPAPI_DAILY_CAP` dans les crochets `[8]` et `[25]` des notes.
- [ ] **`APP_MIN_IOS_BUILD` absent, ou inférieur ou égal au numéro du build envoyé.** Sinon, le testeur d'Apple verra « Mettez à jour Spotto » à la place de l'app (`apps/mobile/src/lib/app-update.ts:1-8`). Vérification : https://spotto-api.onrender.com/api/app/version doit montrer un minimum vide (`null`) ou ≤ au build.
- [ ] **Sentry du serveur** : `SENTRY_DSN` rempli, `SENTRY_ENVIRONMENT` = `production` (`apps/backend/ALERTES.md`).
- [ ] **Le site** (service mon-app-shopping-ia-web) a les réglages de l'éditeur, dont l'e-mail : la page d'assistance https://mon-app-shopping-ia-web.onrender.com/aide doit montrer l'adresse, déconnecté (Apple : l'adresse d'assistance doit mener à de vraies coordonnées).

## D. La base (Supabase → spotto-prod)

- [ ] **Migrations 0029 et 0030 appliquées** (`apps/backend/supabase/REGISTRE-MIGRATIONS.md`). Sans 0030, le masquage automatique après 3 signalements ne marche pas (`apps/backend/src/lib/autoHide.ts:14-17`) : la phrase des notes « Content reported by 3 different people is hidden automatically » serait fausse.
- [ ] **Migrations 0032, 0033 et 0034 appliquées** (messages, collections, signalement des collections ; faites le 9 novembre 2026 d'après le registre) : les notes et la fiche décrivent ces fonctions.
- [ ] **Migrations 0035 et 0036** (notifications, alertes prix et stock) : appliquées **si** les notes et la fiche en parlent ; sinon l'app cache ces fonctions, et leurs paragraphes doivent partir.
- [ ] **Migration 0037** (modération des profils : retirer une bio ou une photo de profil) : appliquée, et vérifiée avec `supabase/verifications/0037-verification.sql`. Sans elle, « Retirer la bio » et « Retirer la photo de profil » ne sont pas proposés dans « Modération », et les mots « (bios and profile photos included) » doivent être retirés des notes.
- [ ] **Un administrateur existe** et voit « Modération » dans Réglages (vous). Il n'est **pas** le compte de démonstration.
- [ ] **Les e-mails de connexion partent** (Authentication → Emails → SMTP) et « Confirm email » est activé : le testeur peut essayer l'inscription.

## E. Le compte de démonstration

Pas de script : chaque pièce du Vault, des Envies ou d'une publication exige une photo, et un script aurait demandé la clé secrète de production sur le Mac. Dans l'app, c'est dix minutes, avec du vrai contenu.

**Le créer (une fois, puis après chaque validation : Apple essaie souvent la suppression du compte)** :
1. Une adresse e-mail que vous lisez, propre à Apple (par exemple un alias de votre messagerie). **Jamais** votre compte administrateur : sa suppression est refusée (`apps/backend/src/routes/account.ts:241`), et Apple essaie la suppression.
2. Dans l'app (build TestFlight), « Commencer » → inscription → confirmer l'e-mail → choisir un nom d'utilisateur.
3. Un mot de passe fort, gardé dans votre gestionnaire de mots de passe. **Jamais** dans ce dépôt, ni dans un e-mail.
4. Du contenu : 2 ou 3 recherches réussies (elles remplissent « Récemment spottées »), 2 ou 3 pièces gardées (Envies), 2 ou 3 pièces dans le Vault, 1 ou 2 publications.
5. Un **second compte, « l'ami »**, créé de la même façon, avec une publication **publique** et un commentaire. Les deux comptes **se suivent l'un l'autre** : le fil n'affiche que ses propres publications et celles des comptes suivis (`apps/backend/src/routes/posts.ts`), et deux comptes qui se suivent sont « amis » (`apps/backend/src/lib/messaging.ts:1-12`). Avec lui, préparez ce que les notes annoncent :
   - une **conversation ouverte**, avec au moins un message **reçu** par le compte de démonstration (écrit depuis le compte ami) : le testeur pourra essayer « ••• » → « Signaler ce message » ;
   - une **collection montrée aux amis** dans le compte ami (deux ou trois envies) : le testeur pourra l'ouvrir depuis son profil et la signaler ;
   - une collection dans le compte de démonstration lui-même.
6. Un **troisième compte**, que le compte de démonstration ne suit pas : il lui envoie **une invitation** (un premier message), laissée sans réponse. Le testeur la trouvera dans Activité → Messages → « Invitations », et pourra l'accepter, la refuser ou bloquer.
7. Le testeur pourra ainsi signaler et bloquer. Chaque signalement du testeur vous enverra une alerte : traitez-le, puis rétablissez le contenu si besoin. **Après chaque passage d'Apple, refaites le scénario** : l'invitation a pu être refusée (aucune nouvelle invitation pendant 30 jours : prenez alors un autre troisième compte), un compte bloqué, un message signalé.

**À chaque envoi :**
- [ ] Le compte se connecte (e-mail confirmé, mot de passe juste, pas suspendu).
- [ ] Il n'est pas administrateur : pas d'entrée « Modération » dans ses Réglages (`apps/mobile/src/app/(app)/settings.tsx:253`).
- [ ] Il a du contenu : Vault, Envies, une collection, publications ; lui et le compte ami se suivent l'un l'autre.
- [ ] La conversation avec le compte ami contient un message reçu, et l'invitation du troisième compte est en attente (Activité → Messages).
- [ ] **Il passe le contrôle anti-robots** : sur le build envoyé, déconnectez-vous, puis reconnectez-vous avec ses identifiants, si possible sur un autre réseau que le vôtre (4G). La connexion doit passer sans que le widget anti-robots bloque (`apps/mobile/ANTI-ROBOTS.md`). Le testeur d'Apple se connecte depuis ses propres réseaux : si la protection est activée dans Supabase et le bloque, il ne peut pas entrer, et l'app est renvoyée (Apple : « Provide App Review with full access to your app. »). En cas de doute, essayez aussi l'inscription d'un compte jetable.
- [ ] Il lui reste des recherches : ne l'utilisez pas le jour de l'envoi ; le compteur repart à minuit, heure de Paris.
- [ ] Ses identifiants sont dans les cases « Identifiant » et « Mot de passe » d'App Store Connect, et dans les crochets des notes.

## F. Juste avant de cliquer « Soumettre pour vérification »

- [ ] https://spotto-api.onrender.com/health répond `"status":"ok"`, avec la `version` = le commit noté en A (`apps/backend/src/app.ts:159`, `MISE-EN-LIGNE.md`, section 5).
- [ ] https://spotto-api.onrender.com/health/deep répond `"status":"ok"` : le serveur **et** la base répondent (`apps/backend/src/app.ts:174`).
- [ ] **Sentry** : aucune nouvelle erreur depuis la mise en ligne ; la règle d'alerte « tag alerte » est active et arrive sur votre téléphone (`apps/backend/ALERTES.md`). Les plantages du build sont lisibles (fichiers envoyés par le build : pas d'erreur Sentry dans le journal du build EAS).
- [ ] **Un essai sur votre iPhone, avec ce build** (TestFlight) : connexion avec le compte de démonstration ; une capture d'écran spottée de bout en bout ; Photos → Partager → Spotto ; une vidéo avec l'écran d'accord ; un message envoyé au compte ami ; « ••• » à côté d'un message reçu → « Signaler ce message » ; l'invitation du troisième compte acceptée ou refusée ; la collection du compte ami ouverte ; signaler puis bloquer le second compte (puis le débloquer : Réglages → Comptes bloqués) ; suppression d'un compte jetable (jamais le compte de démonstration).
- [ ] **Les autorisations refusées** : refusez l'appareil photo, les photos et, si elles sont allumées, les notifications ; l'app doit rester utilisable (règle 5.1.1 (iv) ; les notifications ne sont jamais obligatoires, règle 4.5.4).
- [ ] **Si `PUSH_ENABLED` est allumé** : une notification de message reçue de bout en bout sur ce build (elle dit qui écrit, jamais le texte), puis coupée dans Réglages → « Notifications de messages ».
- [ ] **Sur un iPad** (règle 2.4.1 : « iPhone apps should run on iPad whenever possible ») : l'app est réglée pour l'iPhone seul, mais Apple l'ouvre aussi sur iPad, en format iPhone. Installez le build une fois sur un iPad (TestFlight) : connexion, une recherche, les Réglages ; rien ne doit planter ni rester hors de l'écran. Sans iPad : le simulateur d'iPad de Xcode, avec un build `development-simulator`.
- [ ] **Sur un réseau IPv6 seul** (règle 2.5.5 : « Apps must be fully functional on IPv6-only networks. ») : le Mac sait créer un tel réseau de test (Réglages Système → Général → Partage → Partage Internet, avec l'option « Créer un réseau NAT64 », qui apparaît en maintenant la touche Option ; l'emplacement exact dépend de votre version de macOS). Connectez l'iPhone à ce réseau, puis : connexion, une recherche, ouverture d'un lien marchand. L'app n'appelle ses services que par leur nom, jamais par une adresse chiffrée : l'essai devrait passer.
- [ ] **Les notes** ([NOTES-VALIDATION.md](NOTES-VALIDATION.md)) : crochets remplis ; paragraphe « SERVER » retiré si le serveur ne dort plus ; « OTHER SHOPS » sur ON ou OFF selon Render ; la phrase des 24 heures seulement si vous prenez cet engagement.
- [ ] **La fiche** ([FICHE.md](FICHE.md)) et la **déclaration de confidentialité** ([CONFIDENTIALITE-APPLE.md](CONFIDENTIALITE-APPLE.md)) toujours justes.
- [ ] **Aucun texte provisoire dans les pages en ligne** (règle 2.1 (a) : « placeholder text, empty websites, and other temporary content should be scrubbed before submission »). Ouvrez, **déconnecté**, en français puis en anglais : https://mon-app-shopping-ia-web.onrender.com/confidentialite, /conditions et /aide. Dans chacune, cherchez le caractère `[` (Cmd+F) : il ne doit rester ni « [À compléter », ni « [À vérifier », ni « [To be completed », ni « [To be verified », ni le bandeau « Projet — à faire valider par un professionnel ». Le contrôle du début de build ne voit **pas** le site : ses réglages de l'éditeur sont chez Render (partie C), pas chez Expo. Faites le même contrôle dans l'app (Réglages → Documents).
- [ ] **Chiffrement** : rien à déclarer, c'est réglé dans l'app (`apps/mobile/app.json:23`).
