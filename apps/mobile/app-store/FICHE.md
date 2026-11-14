# La fiche App Store de Spotto (textes à coller)

*Chantier 8, point 8 de la feuille de route V1. Pour le fondateur. Brouillon : la description a été remise à jour le 10 novembre 2026 (lot « conformité Apple ») pour les messages privés et les collections ; les alertes et les notifications sont dans un paragraphe à part, à n'ajouter que si elles sont allumées le jour de l'envoi.*

**Où coller** : App Store Connect → Apps → Spotto → onglet **Distribution** → la version (1.0) → une langue à la fois (**Français**, puis **Anglais (États-Unis)** ou **Anglais (Royaume-Uni)** selon les pays choisis).

**Comment copier** : chaque texte est dans un cadre gris. Copiez tout le contenu du cadre, sans rien ajouter. Les longueurs ont été comptées par un script (le nombre est indiqué sous chaque cadre) ; Apple refuse l'enregistrement au-delà de la limite.

**Ce qui est vrai dans tous les cas** : ces textes ne parlent ni de la « voie C » (autres boutiques, « Que cherchez-vous ? ») ni du lecteur intégré. Ils restent justes que la voie C soit allumée ou coupée. Ils supposent que les messages et les collections marchent en production (migrations 0032 et 0033, appliquées le 9 novembre 2026). Les alertes prix et stock et les notifications dépendent d'un interrupteur du serveur (`PUSH_ENABLED`) et des migrations 0035 et 0036 : leur paragraphe est facultatif (partie 4), parce qu'une fiche ne doit décrire que ce que l'app fait vraiment (règle 2.3.1 d'Apple). Ils ne citent aucune marque d'une autre société (TikTok, Instagram, Google…) : la règle 2.3.7 d'Apple l'interdit dans les mots-clés, et c'est plus sûr ailleurs aussi.

---

## 1. Nom (30 caractères au plus)

```text
Spotto
```
6 caractères. Le même en français et en anglais.

Si Apple répond que « Spotto » est déjà pris, deux replis :

```text
Spotto : trouver la pièce
```
25 caractères (français).

```text
Spotto: Find the Piece
```
22 caractères (anglais).

---

## 2. Sous-titre (30 caractères au plus)

Français :
```text
Trouvez où acheter une pièce
```
28 caractères.

Anglais :
```text
Find where to buy the piece
```
27 caractères.

---

## 3. Texte promotionnel (170 caractères au plus)

Ce texte se change à tout moment, sans nouvelle validation d'Apple.

Français :
```text
Une veste vue dans une vidéo, un sac sur une photo ? Ajoutez une capture d'écran, entourez la pièce : Spotto vous montre où l'acheter, avec le prix quand il le trouve.
```
167 caractères.

Anglais :
```text
Saw a jacket in a video or a bag in a photo? Add a screenshot, circle the piece: Spotto shows you where to buy it, with the price when it finds one.
```
148 caractères.

---

## 4. Description (4 000 caractères au plus)

Elle cite « Partager vers Spotto » (règle 4.4 d'Apple : la fiche décrit l'extension de partage). Dans la feuille de partage d'iOS, l'app s'affiche sous le nom « Spotto ».

Français :
```text
Une veste vue dans une vidéo, un sac aperçu sur une photo, des baskets croisées dans la rue : Spotto vous aide à retrouver la pièce et à savoir où l'acheter.

COMMENT ÇA MARCHE
1. Ajoutez une capture d'écran, une photo de votre galerie ou une vidéo, ou prenez une photo.
2. Entourez la pièce du doigt.
3. Spotto cherche la même pièce, ou les plus proches, et vous montre les boutiques qui la proposent. Les propositions avec un prix passent en premier.

PARTAGER VERS SPOTTO
Depuis Photos ou une autre app, touchez « Partager », puis « Spotto » : la photo ou la vidéo s'ouvre directement dans Spotter, prête à être analysée.

LES VIDÉOS
Choisissez le moment où la pièce se voit bien. Si vous l'acceptez, Spotto peut repérer ce moment pour vous : quelques images réduites de la vidéo sont analysées par une intelligence artificielle. Sans votre accord, aucune image ne part, et la vidéo entière ne quitte jamais votre téléphone.

VOS PIÈCES
• Envies : gardez en un geste les pièces qui vous plaisent.
• Vault : rangez celles que vous possédez, avec leur photo.
• « Récemment spottées » : retrouvez vos dernières recherches.

PARTAGEZ VOTRE STYLE
Publiez vos tenues et vos achats, suivez d'autres passionnés de mode, aimez et commentez. Pour chaque publication, vous choisissez qui la voit : tout le monde, vos abonnés ou vous seul.

ENTRE AMIS
• Messages privés : écrivez à vos amis, ou envoyez une invitation à un autre membre, qui choisit de l'accepter ou non. Vous décidez qui peut vous écrire.
• Collections : rangez vos envies par thème, pour vous seul ou pour vos amis.

UN ESPACE RESPECTUEUX
Les textes injurieux sont refusés avant publication. Vous pouvez signaler une publication, un commentaire, un message, une collection ou un profil, et bloquer un compte. Chaque signalement est examiné par notre équipe.

VOS DONNÉES
Aucune publicité, aucune revente de vos données. Le partage de statistiques d'usage est facultatif. Depuis les Réglages, vous pouvez à tout moment télécharger toutes vos données ou supprimer votre compte.

BON À SAVOIR
• Un compte est nécessaire. Spotto est réservé aux personnes de 15 ans et plus.
• Le nombre de recherches est limité chaque jour.
• Spotto ne vend rien lui-même : les liens ouvrent le site du marchand. Les résultats viennent d'une recherche visuelle et ne sont pas toujours exacts : vérifiez la pièce et son prix chez le marchand.
• Spotto ne lit pas une vidéo à partir de son lien : faites plutôt une capture d'écran du bon moment.
```
2 481 caractères.

Anglais :
```text
A jacket seen in a video, a bag spotted in a photo, sneakers passed in the street: Spotto helps you find the piece and see where to buy it.

HOW IT WORKS
1. Add a screenshot, a photo from your library or a video, or take a photo.
2. Circle the piece with your finger.
3. Spotto looks for the same piece, or the closest ones, and shows you the shops that sell it. Results with a price come first.

SHARE TO SPOTTO
From Photos or another app, tap Share, then "Spotto": the photo or video opens straight in Spotter, ready to be analyzed.

VIDEOS
Pick the moment where the piece is clearly visible. If you agree, Spotto can find that moment for you: a few reduced frames of the video are analyzed by an artificial intelligence. Without your consent, no frame is sent, and the full video never leaves your phone.

YOUR PIECES
• Wishlist: save the pieces you like in one tap.
• Vault: keep the ones you own, with their photo.
• "Recently spotted": find your latest searches again.

SHARE YOUR STYLE
Post your outfits and purchases, follow other fashion lovers, like and comment. For each post, you choose who sees it: everyone, your followers, or only you.

WITH FRIENDS
• Private messages: write to your friends, or send an invitation to another member, who chooses whether to accept it. You decide who can write to you.
• Collections: group your wishes by theme, for yourself or for your friends.

A RESPECTFUL SPACE
Abusive text is refused before it is posted. You can report a post, a comment, a message, a collection or a profile, and block an account. Every report is reviewed by our team.

YOUR DATA
No ads, and we never sell your data. Sharing usage statistics is optional. From Settings, you can download all your data or delete your account at any time.

GOOD TO KNOW
• An account is required. Spotto is for people aged 15 and over.
• The number of searches is limited each day.
• Spotto doesn't sell anything itself: links open the shop's website. Results come from a visual search and aren't always exact: check the piece and its price with the shop.
• Spotto can't read a video from its link: take a screenshot of the right moment instead.
```
2 146 caractères.

**Paragraphe facultatif : alertes et notifications.** À insérer après « ENTRE AMIS » / « WITH FRIENDS » **seulement si**, le jour de l'envoi, `PUSH_ENABLED` vaut `true` chez Render et les migrations 0035 et 0036 sont appliquées en production (sinon l'app ne propose pas ces fonctions, et la fiche mentirait). Décision à prendre avec celle des notes ([NOTES-VALIDATION.md](NOTES-VALIDATION.md), partie 1, point 9).

Français :
```text
ALERTES ET NOTIFICATIONS
Activez la cloche d'une envie pour être prévenu quand son prix baisse ou quand elle revient en stock dans la même boutique. Vous pouvez aussi être prévenu d'un nouveau message. Tout est facultatif et se coupe dans les Réglages.
```
252 caractères (description complète avec lui : 2 735).

Anglais :
```text
ALERTS AND NOTIFICATIONS
Turn on the bell of a wish to be told when its price drops or when it is back in stock at the same shop. You can also be notified of a new message. Everything is optional and can be turned off in Settings.
```
230 caractères (description complète avec lui : 2 378).

**À relire avant de coller** (ce sont vos affirmations, pas des faits que le code garantit seul) :
- « Aucune publicité, aucune revente de vos données » : vrai aujourd'hui. À préciser le jour où un lien affilié rapporte une commission (décision 10 de l'audit, partie 2).
- « Chaque signalement est examiné par notre équipe » : c'est vous ; l'audit demande qui vous remplace pendant vos absences (décision E).
- Le nom de l'app apparaît dans ces textes : il changera avec le nouveau nom (partie 1).

<!--
Preuves (tout est vrai d'après le code de main b99e884 ; les lignes « 10 novembre 2026 » ont été relues sur la branche lot-conformite-apple) :
- 10 novembre 2026 — messages privés, invitation acceptée ou non, « Qui peut m'écrire » : apps/backend/src/lib/messaging.ts:1-12, apps/mobile/src/i18n/fr.ts (messagesFromTitle) ; collections privées ou montrées aux amis : apps/mobile/src/i18n/en.ts (collections.shareConfirmTitle) ; signaler un message ou une collection : packages/shared-types/src/index.ts (REPORT_TARGET_TYPES), apps/mobile/src/app/(app)/conversation.tsx (bouton « ••• »), apps/mobile/src/app/(app)/collection-ami.tsx
- 10 novembre 2026 — paragraphe facultatif : cloche d'une envie, baisse de prix et retour en stock dans la même boutique : fr.ts (wishAlerts.sheetIntro, kinds) ; notification d'un nouveau message : fr.ts (offerBody) ; interrupteurs des Réglages : apps/mobile/src/components/message-push-setting.tsx, wish-alerts-setting.tsx ; coupées par défaut sur le serveur : apps/backend/src/env.ts:64
- capture, photo de la galerie, vidéo, appareil photo : apps/mobile/src/app/(app)/(tabs)/index.tsx:228-231 ; appareil photo : apps/mobile/src/lib/image-import.ts:59 (iPhone seulement, index.tsx:231)
- entourer la pièce : apps/mobile/src/i18n/fr.ts:347-358
- propositions avec prix d'abord : fr.ts:394 (« Meilleure proposition avec prix ») et :450 (« Sans prix affiché »)
- partager vers Spotto : apps/mobile/app.json:111-125 (expo-share-intent), apps/mobile/plugins/extension-partage.js:4-8 (nom affiché « Spotto »), types acceptés app.json:115-118 ; ouverture dans Spotter : index.tsx:170-197
- vidéo : moment choisi fr.ts:137-139 ; analyse automatique avec accord : apps/mobile/src/components/spot-launch-views.tsx:237-268, apps/backend/src/routes/videoMoments.ts:147 ; la vidéo reste sur l'appareil : fr.ts:139 et confidentialite.ts:45
- Envies (« Garder ») fr.ts:411 ; Vault (« Je l'ai achetée », ajout avec photo) fr.ts:414 et :675 ; « Récemment spottées » fr.ts:116
- publications, visibilité public / abonnés / privé : packages/shared-types/src/index.ts:2 (PRIVACY_LEVELS), apps/backend/supabase/migrations/0001_init_schema.sql:12 ; suivre fr.ts:669 ; j'aime apps/backend/src/routes/posts.ts:731 ; commentaires apps/backend/src/routes/comments.ts:106
- textes injurieux refusés : apps/backend/src/routes/comments.ts:120, posts.ts:483, me.ts:185 ; signaler / bloquer : apps/mobile/src/components/report-block-menu.tsx ; « examiné par l'équipe » : texte de l'app fr.ts (help.faq, « Signaler un contenu »)
- aucune publicité, statistiques facultatives : apps/mobile/src/lib/analytics.ts:5-9 ; export et suppression : apps/backend/src/routes/account.ts:170 et :238
- 15 ans : packages/shared-types/src/index.ts:775 ; recherches limitées : apps/backend/src/env.ts:17-22
- un lien ne se lit pas : apps/mobile/src/lib/link-step.ts
-->

---

## 5. Mots-clés (100 octets au plus)

Attention : Apple compte en **octets**, pas en caractères. Une lettre accentuée (é, è…) compte pour 2. Pas d'espace après les virgules. Inutile de répéter le nom de l'app, le sous-titre ou la catégorie : Apple les prend déjà en compte.

Français :
```text
mode,tenue,look,style,vetements,habits,shopping,capture,identifier,sac,baskets,robe,veste,dressing
```
98 octets (mots sans accents, pour tenir dans les 100 octets).

Anglais :
```text
fashion,outfit,clothes,style,shopping,screenshot,identify,lookup,dress,sneakers,bag,jacket,wardrobe
```
99 octets.

---

## 6. Catégories conseillées

- **Catégorie principale : Shopping** (Achats). C'est l'usage premier : trouver où acheter une pièce.
- **Catégorie secondaire : Style de vie** (Lifestyle). Le fil, le Vault et les Envies relèvent de la mode au quotidien.

Je déconseille « Réseaux sociaux » en principale : le fil n'est pas le cœur de l'app, et cette catégorie appelle un examen plus strict de la modération.

---

## 7. Adresses à fournir

| Champ d'App Store Connect | Adresse | Obligatoire ? | État aujourd'hui |
|---|---|---|---|
| **URL d'assistance** (*Support URL*) | `https://mon-app-shopping-ia-web.onrender.com/aide` (ou la même page sur le futur nom de domaine) | Oui | La page existe : « Aide et contact », lisible sans compte (`apps/mobile/src/app/aide.tsx`, ouverte à tous : `apps/mobile/src/app/_layout.tsx:104`). ⚠️ Apple exige qu'elle mène à de vraies coordonnées : l'adresse e-mail n'y apparaît que si `EXPO_PUBLIC_PUBLISHER_EMAIL` est saisie pour le **site** chez Render, puis le site reconstruit (« Clear build cache & deploy »). Sinon la page affiche « [À compléter : …] ». À vérifier en ouvrant la page, déconnecté, avant l'envoi. |
| **URL de la politique de confidentialité** | `https://mon-app-shopping-ia-web.onrender.com/confidentialite` | Oui | La page existe, lisible sans compte (`apps/mobile/src/app/_layout.tsx:102`). Elle doit être la version définitive (sans bandeau « Projet », sans « [À compléter] ») le jour de l'envoi : règle 5.1.1(i) d'Apple, et point 7 de la feuille de route. |
| **URL marketing** | Facultative. Laisser vide, ou mettre l'accueil du site. | Non | — |
| **Copyright** | `2026 [À compléter : nom de l'éditeur]` | Oui | Le nom exact de l'éditeur, comme dans les pages légales. |
| **Coordonnées pour l'équipe de validation** (prénom, nom, téléphone, e-mail) | [À compléter] | Oui | Vos coordonnées, vues seulement par Apple. Jamais dans ce dépôt public. |
| **Compte de démonstration** | voir [NOTES-VALIDATION.md](NOTES-VALIDATION.md) | Oui (l'app demande un compte) | À créer : [CONTROLE-BUILD.md](CONTROLE-BUILD.md), partie E. |

**Autres réglages de la fiche** (des faits, pour cocher vite) :
- Prix : **gratuit**. Achats intégrés : **aucun** (rien dans le code).
- iPad : **non**. L'app est réglée pour l'iPhone seul (`"supportsTablet": false`, `apps/mobile/app.json:20`) : seules les captures iPhone sont demandées.
- Chiffrement : déjà déclaré dans l'app (`ITSAppUsesNonExemptEncryption: false`, `apps/mobile/app.json:23`) : App Store Connect ne pose plus la question à chaque build.
- Connexion « avec Apple » : non requise. Spotto ne propose que l'e-mail et le mot de passe, aucune connexion par un autre service (Google, Facebook…).
- Contrat de licence (EULA) : App Store Connect propose le contrat standard d'Apple, ou un contrat personnalisé. C'est à vous de choisir ; les conditions d'utilisation de Spotto s'affichent de toute façon dans l'app, à l'inscription.
- Âge et pays : [AGE-ET-PAYS.md](AGE-ET-PAYS.md).
