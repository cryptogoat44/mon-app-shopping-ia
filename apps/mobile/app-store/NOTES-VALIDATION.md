# Les notes pour l'équipe de validation d'Apple

*Chantier 8, point 8 de la feuille de route V1. Pour le fondateur.*

**Où coller** : App Store Connect → Spotto → la version → section **Informations pour la validation de l'app** (*App Review Information*) :
- **Identifiant** et **mot de passe** du compte de démonstration : dans leurs deux cases (pas seulement dans les notes) ;
- **Remarques** (*Notes*) : la **version anglaise** ci-dessous (partie 3). Apple lit l'anglais. Limite : 4 000 octets ; le texte en fait 3 494, crochets compris : il reste de la marge pour vos identifiants.
- **Pièce jointe** (facultative, conseillée) : une courte vidéo d'écran de votre iPhone qui montre « Partager vers Spotto » depuis Photos. Elle évite un aller-retour si le testeur ne trouve pas l'extension.

**Règle** : chaque phrase a été vérifiée dans le code de `main` (b99e884). La preuve (fichier:ligne) est dans un commentaire invisible sous chaque paragraphe de la version française. Si le code change d'ici l'envoi, revérifiez le paragraphe concerné.

---

## 1. Avant de coller : ce qu'il reste à remplir

Tous les morceaux entre crochets `[…]` de la version anglaise :

1. **`[À compléter]`** (3 fois) : l'e-mail et le mot de passe du compte de démonstration, et le nom d'utilisateur du second compte (celui qu'il suit). Voir [CONTROLE-BUILD.md](CONTROLE-BUILD.md), partie E.
2. **`[8]` et `[25]`** : les plafonds réels de Render (`SERPAPI_USER_DAILY_CAP` et `SERPAPI_DAILY_CAP`). 8 et 25 sont les valeurs par défaut du code ; elles seront relevées avec l'offre SerpApi payante.
3. **`[ON/OFF]`** : l'état de la voie C chez Render le jour de l'envoi (`VOIE_C_ENABLED`). Gardez un seul des deux mots. Le paragraphe reste dans tous les cas (règle 2.5.19 : aucune fonction dormante non décrite).
4. **Le paragraphe « SERVER »** : supprimez-le si le serveur est passé sur une offre Render sans veille (c'est ce qu'il faut faire avant l'envoi, point 16).
5. **La phrase « We review reports within 24 hours »** : ne la laissez que si vous prenez cet engagement (alerte Sentry reçue sur votre téléphone, week-end compris).

---

## 2. Version française (pour vous : ce que dit le texte anglais)

### Compte de démonstration

E-mail : [À compléter]. Mot de passe : [À compléter]. L'adresse est confirmée, le compte contient des exemples (Vault, Envies, publications) et suit un second compte, @[À compléter], dont une publication et un commentaire permettent d'essayer « Signaler » et « Bloquer ». Spotto demande un compte : l'inscription marche aussi, mais elle exige de confirmer une adresse e-mail.

<!-- Preuves : compte obligatoire, groupes d'écrans protégés : apps/mobile/src/app/_layout.tsx:78-96 et apps/mobile/src/lib/root-route.ts:23-37 ; confirmation de l'e-mail : apps/mobile/src/i18n/fr.ts:1089 (auth.errors.emailNotConfirmed) et apps/mobile/src/app/sign-up.tsx:69 ; le fil montre les publications des comptes suivis : apps/backend/src/routes/posts.ts:377-386 (d'où le second compte à suivre) ; compte non administrateur obligatoire : apps/backend/src/routes/account.ts:241. -->

### Comment spotter une pièce (onglet Spotter)

1. Touchez « Ajouter une photo » (galerie ou capture d'écran), « Prendre une photo » (appareil photo) ou « Ajouter une vidéo ». La vidéo reste sur l'iPhone ; vous choisissez une image.
2. Pour une photo : entourez la pièce (ou « Utiliser toute l'image »), puis « Lancer ». Pour une vidéo : décrivez la pièce en quelques mots, puis « Lancer ».
3. Les résultats arrivent en 10 à 20 secondes ; ceux qui ont un prix passent en premier. « Voir chez [boutique] » ouvre la page du marchand dans une fenêtre Safari intégrée à l'app.
4. « Garder » ajoute un résultat aux Envies ; « Je l'ai achetée », au Vault (onglet Profil).

Un lien TikTok, Instagram ou Pinterest collé n'est pas lu : Spotto explique comment ajouter une capture d'écran à la place.

<!-- Preuves : les trois boutons : apps/mobile/src/app/(app)/(tabs)/index.tsx:228-231 (« Prendre une photo » sur iPhone seulement, :231), apps/mobile/src/lib/image-import.ts:59 (appareil photo) ; textes fr.ts:100-101 et :1166 ; la vidéo reste sur l'appareil : fr.ts:139 ; entourer : apps/mobile/src/components/spot-launch-views.tsx:86-97, fr.ts:347-357 ; « Lancer » attend la zone (photo) ou des mots (vidéo avec analyse) : apps/mobile/src/app/(app)/spot/lancer.tsx:139 et :156 ; durée annoncée : fr.ts:362 ; prix d'abord : fr.ts:394 et :450 ; Safari intégré : apps/mobile/src/lib/merchant-links.ts:90-93 (WebBrowser.openBrowserAsync) ; « Garder » fr.ts:411, « Je l'ai achetée » fr.ts:414 ; lien non lu : apps/mobile/src/lib/spot-flags.ts:7, apps/mobile/src/lib/link-step.ts:35-38, apps/mobile/src/lib/use-link-entry.ts:14 (aucun appel au serveur), aide fr.ts:255-260. -->

### L'analyse automatique des vidéos (avec accord)

Avec une vidéo, Spotto peut trouver le bon moment. Avant qu'aucune image ne quitte l'iPhone, un écran d'accord explique que 12 images réduites au plus et la description tapée sont envoyées à Anthropic (prestataire d'IA, États-Unis). « Choisir l'image moi-même » refuse : rien n'est envoyé. Le serveur revérifie l'accord avant chaque analyse ; il se retire dans Réglages → Vos données.

<!-- Preuves : écran d'accord : apps/mobile/src/components/spot-launch-views.tsx:237-268, texte fr.ts:167-171 ; affiché avant tout envoi quand l'accord n'est pas donné : apps/mobile/src/lib/use-spot-launch.ts:224 ; refus = curseur manuel, aucun envoi : fr.ts:164 (chooseMyself) et spot-launch-views.tsx:265-267 ; 12 images au plus : packages/shared-types/src/index.ts:237 ; revérifié par le serveur : apps/backend/src/routes/videoMoments.ts:147 ; réglage : fr.ts:786-790 ; la fonction n'est proposée que si la clé Anthropic est saisie chez Render : apps/backend/src/routes/videoMoments.ts:107-110. -->

### L'extension de partage

Dans Photos ou une autre app, touchez « Partager », puis « Spotto » : une photo ou une vidéo s'ouvre directement dans Spotter ; un lien ouvre l'aide « capture d'écran ». Un seul élément à la fois ; déconnecté, il s'ouvre après la connexion.

<!-- Preuves : extension déclarée : apps/mobile/app.json:111-125, types acceptés :115-118 (un lien, une image, une vidéo, du texte) ; nom affiché « Spotto » : apps/mobile/plugins/extension-partage.js:5-8 ; ouverture dans Spotter : apps/mobile/src/app/(app)/(tabs)/index.tsx:170-197 (lien → aide, :177-186) ; un seul élément : fr.ts:243 ; déconnecté : fr.ts:236 ; partage gardé 24 h si iOS ne rouvre pas l'app : apps/mobile/src/lib/shared-item.ts:126. -->

### Le serveur (seulement en offre gratuite)

Le serveur peut s'endormir quand personne ne s'en sert. Le premier lancement peut alors prendre jusqu'à une minute et affiche « Spotto se réveille… » ; une recherche lente affiche « le service redémarre peut-être ».

<!-- Preuves : message au démarrage après 3 s : apps/mobile/src/lib/root-route.ts:53, textes fr.ts:1079-1080 (en.ts:1004-1005) ; essais répétés pendant environ une minute : apps/mobile/src/lib/retry.ts:1-4 ; recherche lente après 20 s : apps/mobile/src/app/(app)/spot/analysis.tsx:17, fr.ts:363 (en.ts:343). -->

### Les plafonds de recherche

Chaque personne a [8] recherches par jour, tout le service [25] par jour, et 10 par heure. Les jours repartent à minuit, heure de Paris (15 h à Cupertino). À 3 restantes ou moins, l'onglet Spotter dit combien il en reste ; à zéro, il affiche « Vous avez utilisé vos [8] recherches du jour » et le bouton « Lancer » est désactivé. Rouvrir un ancien résultat est gratuit.

<!-- Preuves : plafonds par défaut 25 par jour pour tous, 8 par personne : apps/backend/src/env.ts:17 et :22 ; 10 par heure : apps/backend/src/lib/rateLimits.ts:31 et fr.ts:460 ; minuit de Paris : apps/backend/src/lib/searchCapacityStatus.ts:14 et :25 ; annonce à 3 ou moins : apps/mobile/src/lib/search-limits.ts:15 et :36 ; « Vous avez utilisé vos N recherches du jour » : fr.ts:959 (en.ts:891) ; lancement bloqué : search-limits.ts:41-43 ; plafond atteint au lancement : fr.ts:464-470 ; rouvrir est gratuit : fr.ts:556 (en.ts:507). Attention : avec la voie C, une photo peut coûter jusqu'à 3 recherches du plafond de tout le service (apps/backend/src/lib/deadline.ts:36, apps/backend/src/lib/searchCapacityStatus.ts:47-49). -->

### Autres boutiques (interrupteur du serveur, aujourd'hui [allumé/coupé])

Allumé, sous les résultats de la recherche visuelle, Spotto ajoute « Cette pièce dans d'autres boutiques » : une IA (Anthropic) lit seulement les titres et les noms de sites des 15 premiers résultats, jamais l'image ni les mots de la personne, et écrit une courte recherche envoyée à Google Shopping par SerpApi. Quand rien de fiable n'est trouvé, « Pas tout à fait ça ? » permet de taper quelques mots, envoyés une fois à Google Shopping. 3 recherches au plus par photo. Aucune nouvelle autorisation, aucune photo envoyée à une IA. Coupé, ces sections n'apparaissent jamais.

<!-- Preuves : interrupteurs coupés par défaut, seule la valeur exacte "true" les allume : apps/backend/src/env.ts:30-51, apps/backend/src/lib/aiSwitches.ts:22-29 ; actif seulement interrupteur allumé ET migration 0028 : apps/backend/src/lib/voieC.ts:863-867 ; coupé = le chemin d'avant, Lens seul : apps/backend/src/routes/searches.ts:1068-1083 ; route des mots refusée (404) quand c'est coupé : searches.ts:1103 ; titres et sites des 15 premiers résultats, jamais d'image : apps/backend/src/services/shoppingQueryAi.ts:8 et :181-186 ; image refusée tant que ANTHROPIC_PHOTO_ENABLED est coupé : aiSwitches.ts:65-68 ; « Que cherchez-vous ? » proposé quand Lens ne trouve rien ou rien de fiable : voieC.ts:663 et :689-693 ; une seule fois par recherche : searches.ts:1125-1127 ; 3 recherches au plus : apps/backend/src/lib/deadline.ts:36 ; titres affichés : fr.ts:503-505 (en.ts:461-463), « Pas tout à fait ça ? » fr.ts:508 (en.ts:465), mention SerpApi et Google Shopping : fr.ts:511-512. L'IA de la voie C a en plus son propre interrupteur (VOIE_C_AI_ENABLED, env.ts:48-51) : coupé, seul « Que cherchez-vous ? » peut apparaître, quand Lens ne trouve rien (voieC.ts:663-664 : Lens vide, puis IA coupée). -->

### La modération (règle 1.2)

- Un filtre de mots interdits (français et anglais) refuse les légendes, commentaires, noms d'utilisateur, noms affichés et bios qui en contiennent.
- Signaler : menu « ••• » de toute publication, tout commentaire, tout profil, toute pièce reçue. Le contenu disparaît aussitôt pour la personne qui le signale.
- Bloquer : même menu ; on ne voit plus les publications de ce compte, et il ne peut plus vous suivre. Réglages → Comptes bloqués.
- Un contenu signalé par 3 personnes différentes est masqué automatiquement en attendant l'examen.
- Chaque signalement prévient notre équipe. Nous traitons les signalements en moins de 24 heures, retirons les contenus choquants et suspendons les comptes abusifs.
- Contact : Réglages → Aide et contact, et l'adresse d'assistance de la fiche.

<!-- Preuves : filtre : apps/backend/src/lib/contentFilter.ts:1-21 (listes FR/EN), appliqué aux commentaires apps/backend/src/routes/comments.ts:120, légendes apps/backend/src/routes/posts.ts:483, nom d'utilisateur, nom affiché et bio apps/backend/src/routes/me.ts:185 ; menu « ••• » (Plus d'options) : apps/mobile/src/components/post-card.tsx:131, apps/mobile/src/components/comments-section.tsx:154, apps/mobile/src/app/(app)/profil.tsx:110, pièces reçues apps/mobile/src/components/received-pieces.tsx (ReportBlockMenu) ; signalement enregistré, alerte, masquage : apps/backend/src/routes/reports.ts:43-66 ; disparaît pour qui signale : apps/backend/src/routes/posts.ts:393, comments.ts:88, apps/backend/src/routes/pieces.ts:266, texte fr.ts:1067 ; blocage : apps/backend/src/routes/blocks.ts:13-51, texte fr.ts:981 (blockConfirm) ; comptes bloqués dans Réglages : apps/mobile/src/app/(app)/settings.tsx:149-150 ; 3 personnes différentes : apps/backend/src/lib/autoHide.ts:22, apps/backend/supabase/migrations/0030_masquage_automatique.sql:39-114 (⚠️ vrai seulement si 0030 est appliquée sur spotto-prod : CONTROLE-BUILD.md, partie D) ; alerte à chaque signalement : apps/backend/src/lib/sentry.ts (captureModerationEvent) et apps/backend/ALERTES.md ; masquer, suspendre (administrateurs) : apps/backend/src/routes/moderation.ts:102, compte suspendu bloqué : apps/backend/src/plugins/moderation.ts:27-29 ; « moins de 24 heures » : un ENGAGEMENT du fondateur, pas du code (le code fournit l'alerte) ; contact : apps/mobile/src/app/(app)/settings.tsx:187-193, page apps/mobile/src/app/aide.tsx, adresse lue à la construction apps/mobile/src/lib/contact.ts:37. -->

### La suppression du compte

Profil → icône des réglages → « Supprimer mon compte » → taper SUPPRIMER (DELETE en anglais) → « Confirmer la suppression ». Le compte, ses données et ses photos sont effacés aussitôt.

<!-- Preuves : accès aux Réglages depuis le Profil : apps/mobile/src/app/(app)/(tabs)/profile/index.tsx:159 ; section : apps/mobile/src/components/delete-account-section.tsx:44-78 ; mot à taper : packages/shared-types/src/index.ts:52 ; suppression des fichiers puis du compte : apps/backend/src/routes/account.ts:238-280 ; un compte administrateur ne peut pas être supprimé (d'où un compte de démonstration jamais administrateur) : account.ts:28-32 et :241. -->

### Le reste

Pas de publicité, pas d'achat intégré, pas de suivi publicitaire. Autorisations : l'appareil photo, et les photos seulement pour la suggestion facultative « dernière vidéo ».

<!-- Preuves : aucune bibliothèque de publicité ni de suivi (aucun « tracking-transparency », « AdSupport » ni « IDFA » dans apps/mobile) ; statistiques sans cookie, avec accord : apps/mobile/src/lib/analytics.ts:1-12 ; autorisations : apps/mobile/app.json:90-92 (photos, appareil photo, micro coupé) et :104 ; l'import d'une photo passe par le sélecteur d'iOS, sans autorisation ; seule « Votre dernière vidéo » demande l'accès aux photos : fr.ts:105-107. -->

---

## 3. Version anglaise (à coller dans « Remarques »)

```text
DEMO ACCOUNT
Email: [À compléter]
Password: [À compléter]
Confirmed email, sample content (Vault, Wishlist, posts). It follows a second account, @[À compléter], whose post and comment can be used to test Report and Block. Spotto requires an account; sign-up also works but needs email confirmation.

HOW TO SPOT A PIECE (Spotter tab)
1. Tap "Add a photo" (library or screenshot), "Take a photo" (camera) or "Add a video" (the video stays on the device).
2. Photo: circle the piece (or "Use the whole image"), then tap "Search". Video: describe the piece in a few words, then tap "Search".
3. Results take 10-20 s; results with a price come first. "View at [shop]" opens the shop page in an in-app Safari view.
4. "Save" adds a result to the Wishlist, "I bought it" to the Vault (Profile tab).
A pasted TikTok, Instagram or Pinterest link is not read: Spotto shows how to add a screenshot instead.

AUTOMATIC VIDEO ANALYSIS (opt-in)
With a video, Spotto can find the right moment. Before any frame leaves the device, a consent screen explains that up to 12 reduced frames and the user's description are sent to Anthropic (AI provider, USA). "Choose the frame myself" declines: nothing is sent. The server re-checks consent before each analysis; it can be withdrawn in Settings > Your data.

SHARE EXTENSION
In Photos or another app, tap Share, then "Spotto": a photo or video opens directly in Spotter; a link opens the screenshot help. One item at a time; if signed out, it opens after sign-in.

SERVER
Our server may sleep when unused. The first launch can then take up to one minute and shows "Spotto is waking up..."; a slow search shows "the service may be restarting".

SEARCH LIMITS
Each person has [8] searches per day, the whole service [25] per day, and 10 per hour. Days reset at midnight Paris time (3 pm in Cupertino). With 3 or fewer left, the Spotter tab says how many remain; at zero it shows "You've used your [8] searches for today" and the Search button is disabled. Reopening past results is free.

OTHER SHOPS (server switch, currently [ON/OFF])
When on, below the visual results Spotto adds "This piece at other shops": an AI (Anthropic) reads only the titles and site names of the first 15 results, never the image or the user's words, and writes a short query sent to Google Shopping via SerpApi. When nothing reliable is found, "Not quite right?" lets the user type a few words, sent once to Google Shopping. At most 3 searches per photo. No new permission, no photo sent to an AI. When off, these sections never appear.

MODERATION (Guideline 1.2)
- A banned-words filter (French and English) refuses captions, comments, usernames, display names and bios containing those words.
- Report: "..." menu on any post, comment, profile or received piece. The item disappears at once for the reporter.
- Block: same menu; you no longer see that account's posts and it can no longer follow you. Settings > Blocked accounts.
- Content reported by 3 different people is hidden automatically until reviewed.
- Each report alerts our team. We review reports within 24 hours, remove objectionable content and suspend abusive accounts.
- Contact: Settings > Help and contact, and the Support URL.

ACCOUNT DELETION
Profile > gear icon (Settings) > Delete my account > type DELETE > Confirm deletion. The account, its data and photos are deleted at once.

No ads, no in-app purchases, no tracking. Permissions: camera, and photos only for the optional "latest video" suggestion.
```

3 494 octets (limite d'Apple : 4 000), crochets compris. Sans le paragraphe « SERVER » : environ 3 300.

---

## 4. Si Apple pose une question

Répondez dans App Store Connect (Centre de résolution), en anglais, court et factuel. Les cas les plus probables :
- **« Nous n'avons pas pu nous connecter »** : vérifiez que le compte existe encore (Apple essaie souvent la suppression du compte, et peut l'avoir supprimé), qu'il n'est pas suspendu, puis recréez-le si besoin et redonnez les identifiants.
- **« Le serveur ne répond pas »** : ouvrez https://spotto-api.onrender.com/health puis /health/deep ([CONTROLE-BUILD.md](CONTROLE-BUILD.md), partie F).
- **« Nous ne trouvons pas l'extension de partage »** : joignez la vidéo d'écran (Photos → Partager → Spotto ; si « Spotto » n'apparaît pas, « Modifier les actions » en bas de la feuille de partage).
- **Une question sur l'IA ou les données** : renvoyez aux paragraphes « AUTOMATIC VIDEO ANALYSIS » et « OTHER SHOPS », et à la politique de confidentialité.
