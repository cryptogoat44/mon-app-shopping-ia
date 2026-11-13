# Le nom du produit : où il est écrit, comment le changer

« Spotto » est un nom de travail : il **changera**. Rien de ce qui dépend du nom n'est figé dans le code. Ce document dit où le nom est défini, ce qui suit tout seul quand on le change, ce qu'il faut changer ailleurs à la main, et ce qu'il faut avoir choisi avant d'enregistrer quoi que ce soit chez Apple ou chez Expo.

## 1. Changer le nom : le fichier à modifier

Un seul fichier : **`packages/shared-types/marque.json`**

Il est rangé dans ce dossier parce que c'est le seul que l'app, le site, le serveur et la configuration Expo lisent déjà tous. Après une modification, il faut reconstruire l'app et remettre en ligne le site et le serveur pour que le nouveau nom apparaisse.

| Ligne | Valeur d'aujourd'hui | Ce qu'elle change |
| --- | --- | --- |
| `nom` | `Spotto` | Le nom montré aux personnes, partout : sous l'icône de l'iPhone, dans la feuille de partage d'iOS, dans tous les textes de l'app et du site (français et anglais), dans les conditions d'utilisation et la politique de confidentialité, dans les fenêtres d'autorisation d'iOS (photos), dans le titre des pages du site, dans les messages d'erreur du serveur, dans le titre des notifications, dans le fichier « Mes données », dans les textes de partage (« Repérée avec… »). |
| `slugExpo` | `spotto` | Le nom du projet chez Expo (dans l'adresse du projet sur expo.dev). Minuscules, chiffres et tirets. |
| `schemaLiens` | `spotto` | Le début des liens qui ouvrent l'app (`spotto://…`) : retour après « mot de passe oublié », réouverture par la feuille de partage. Minuscules et chiffres seulement, sans espace ni tiret. |
| `identifiantApple` | `com.spottoapp.ios` | L'identifiant de l'app chez Apple (« bundle identifier »). C'est lui qu'Apple enregistre. |
| `groupeApple` | `group.com.spottoapp.ios` | Le « groupe d'apps » qui relie l'app à son extension de partage. Doit commencer par `group.`. |
| `identifiantExtensionPartage` | `com.spottoapp.ios.share-extension` | L'identifiant de l'extension de partage. Doit commencer par l'identifiant de l'app, suivi d'un point. |
| `adresseSite` | `https://mon-app-shopping-ia-web.onrender.com` | L'adresse publique du site : elle est mise dans les liens partagés depuis l'app iPhone et annoncée aux boutiques quand le serveur va chercher une image. À changer le jour où vous avez un nom de domaine. Sans `/` à la fin. |
| `adresseServeur` | `https://spotto-api.onrender.com` | L'adresse du serveur de production. Le contrôle du début d'un build iPhone (`apps/mobile/scripts/verifier-build.js`) arrête un build « preview » ou « production » dont la variable `EXPO_PUBLIC_API_URL` n'est pas **exactement** cette adresse (par exemple le serveur de test) ; les en-têtes de sécurité du site (`apps/mobile/web-headers.ts`) et le garde-fou du script `render-bride` la lisent aussi ici. Sans `/` à la fin. |

La ligne `_aLire` est un simple rappel : elle ne sert à rien d'autre.

Trois choses se déduisent du nom, sans ligne à part :

- le nom en minuscules, affiché en grand sur l'écran d'accueil (`spotto`) ;
- le début du nom du fichier « Mes données » (`spotto-mes-donnees-…`), sans accent ni espace ;
- le nom annoncé aux boutiques par le serveur (`Spotto/1.0`), sans accent ni espace.

### Comment c'est garanti

- `apps/mobile/app.json` et `apps/mobile/locales/*.json` n'écrivent plus le nom : ils portent des repères entre accolades (`{nom}`, `{identifiantApple}`…) que `apps/mobile/app.config.js` remplace par les lignes du fichier unique.
- L'app lit le fichier dans `apps/mobile/src/constants/brand.ts`, le serveur dans `apps/backend/src/lib/brand.ts` ; le contrôle du début d'un build (`apps/mobile/scripts/verifier-build.js`) et les en-têtes du site (`apps/mobile/web-headers.ts`) le lisent directement.
- Deux tests échouent si le nom est de nouveau écrit en dur dans un endroit que les personnes voient : `apps/mobile/tests/marque.test.ts` et `apps/backend/tests/marque.test.ts`. Ils essaient aussi un autre nom et vérifient que l'ancien a disparu partout.

### Le jour du changement : ce qu'il reste à relire

- **Des tests citent le nom actuel** dans ce qu'ils attendent (« Mettez à jour Spotto », `com.spottoapp.ios`…) : une cinquantaine échoueront et seront à mettre à jour par Claude. C'est voulu : ils montrent exactement ce qui a changé à l'écran.
- **Les outils d'essai sur simulateur** (`apps/backend/scripts/parcours-iphone`) écrivent l'identifiant Apple et le schéma des liens en dur : à mettre à jour en même temps.
- **Des phrases françaises à relire si le nouveau nom commence par une voyelle** (« de Spotto » deviendrait « d'… », « que Spotto » deviendrait « qu'… ») : 13 phrases, dans `apps/mobile/src/i18n/fr.ts` (« Partager hors de… », « Les notifications de… », « sans que… lise », « l'équipe de… », « effacée de… », « Cette version de… »), dans les textes juridiques (« votre utilisation de… », « Pour que… puisse », « l'éditeur de… ») et dans le fichier « Mes données » du serveur (« les pièces que… vous a proposées », « ce que… sait », « les données personnelles que… conserve », « Cette version de… »).
- **Des phrases accordées au masculin** (« Spotto est réservé aux personnes… », « Spotto est édité par… », « Spotto ne les garde pas ; il garde… », « vous pouvez le lui retirer », « autorisez-le », « Montrez-lui… ») : à relire si le nouveau nom se dit au féminin.
- **Les mots de la même famille ne suivent pas** : « Spotter » (le nom de la fonction) et « spottées » (« Récemment spottées »). Ils ne contiennent pas le nom ; à vous de dire s'ils restent.
- **La version des textes juridiques** : changer le nom modifie le texte des conditions et de la politique de confidentialité. À décider avec Claude : faut-il une nouvelle version (et une nouvelle acceptation) ?

## 2. Ce qui se change ailleurs, à la main

Ces endroits ne sont pas dans le code de l'app : le fichier unique ne peut pas les atteindre.

| Où | Quoi |
| --- | --- |
| **Supabase** (projets spotto-prod et spotto-dev-2) | Les trois modèles d'e-mails (`apps/backend/supabase/emails/*.html`, à recoller dans Supabase) et leurs sujets, le nom de l'expéditeur (« Sender name »), l'adresse du site (« Site URL ») et les adresses de retour (« Redirect URLs », dont `spotto://nouveau-mot-de-passe`, qui suit `schemaLiens`). Marche à suivre : `apps/backend/supabase/emails/REGLAGES-SUPABASE.md`. Le nom des projets Supabase eux-mêmes peut rester : personne ne le voit. |
| **Logo et écran de démarrage** | Les images de `apps/mobile/assets/marque` (icône, « S » de l'écran de démarrage) et de `apps/mobile/assets/images`. Si le logo change, Claude les régénère (`pnpm --filter backend images-marque`). |
| **Fiche App Store** | Les brouillons de `apps/mobile/app-store` (nom, sous-titre, description, notes pour la validation, captures d'écran) : à réécrire avec le nouveau nom, puis à saisir dans App Store Connect. |
| **Render** | Le nom des deux services et leurs adresses (`spotto-api.onrender.com` pour le serveur, `mon-app-shopping-ia-web.onrender.com` pour le site). Si l'adresse du serveur change : la ligne `adresseServeur` du fichier unique, puis la variable `EXPO_PUBLIC_API_URL` (sur Render pour le site, chez Expo pour l'app) ; recopiez aussi la nouvelle adresse dans `apps/mobile/EN-TETES-SITE.md` (les en-têtes à coller chez Render), avec Claude. Si l'adresse du site change : la ligne `adresseSite` du fichier unique, la variable `EXPO_PUBLIC_WEB_URL` si elle est réglée, et les réglages Supabase ci-dessus. |
| **Nom de domaine** | À acheter et à brancher sur le site (Render), puis reporter l'adresse dans `adresseSite`. L'adresse d'expédition des e-mails devrait être sur ce domaine. |
| **Sentry** | Le nom du projet (affiché à vous seul). Rien à changer dans le code : l'app et le serveur le désignent par un numéro. |
| **PostHog** | Le nom du projet (affiché à vous seul). |
| **Cloudflare Turnstile** (anti-robots) | Le nom du widget et la liste des adresses de site autorisées : y ajouter le nouveau nom de domaine. |
| **GitHub** | Le nom du dépôt (`mon-app-shopping-ia`) et celui des secrets (`SPOTTO_DEV_…`) : visibles de vous seul, ils peuvent rester. |
| **Apple et Expo** | Voir la section 3 : une fois enregistrés, l'identifiant et le projet ne se renomment pas simplement. |
| **Identité de l'éditeur** | Rien à voir avec le nom du produit : elle vient des variables `EXPO_PUBLIC_PUBLISHER_*` (`apps/mobile/src/legal/publisher.ts`). |

Ce qui garde l'ancien nom de travail, exprès, parce que personne ne le voit : le nom des dossiers et des paquets, les clés de rangement sur l'appareil (`spotto.langue`, `spotto.apparence`…), l'en-tête technique `x-spotto-build`, les commentaires du code, les données des tests, les scripts et les documents internes.

## 3. À choisir AVANT

Aujourd'hui, rien n'est enregistré chez Apple ni chez Expo. Tant que c'est le cas, changer une ligne du fichier unique suffit. Trois étapes rendent certaines lignes difficiles à changer : **décidez le nom définitif avant de les faire.**

1. **Avant le premier `eas init`** (création du projet chez Expo) : `slugExpo`, et le compte Expo propriétaire du projet (« owner »). `eas init` écrit dans `apps/mobile/app.json` l'identifiant du projet, lié à ce nom et à ce compte. Changer ensuite, c'est créer un autre projet chez Expo (les mises à jour à distance et l'historique des builds ne suivent pas).
2. **Avant l'inscription au programme Apple et la création de l'app chez Apple** : `identifiantApple`, `groupeApple` et `identifiantExtensionPartage`. Une fois l'app créée dans App Store Connect, son identifiant ne peut plus être modifié : il faudrait créer une autre app, avec une nouvelle fiche et une nouvelle validation. Le nom affiché (`nom`), lui, peut encore changer d'une version à l'autre, mais il doit être libre sur l'App Store : vérifiez-le avant.
3. **Avant le premier build envoyé à des testeurs** : `schemaLiens` et `nom`. Le schéma des liens est inscrit dans chaque app installée ; le changer oblige tout le monde à réinstaller, et à corriger les adresses de retour dans Supabase. Les clés de rangement et les réglages gardés sur l'iPhone sont liés à l'identifiant Apple : un changement d'identifiant fait repartir chaque personne d'une app neuve.

Conseil : choisir des identifiants qui ne contiennent pas le nom du produit (par exemple le nom de votre société) évite d'avoir à y revenir si le nom change encore après la sortie.
