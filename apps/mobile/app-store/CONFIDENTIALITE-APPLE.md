# Les réponses « App Privacy » (la déclaration de confidentialité d'App Store Connect)

*Chantier 8, point 8 de la feuille de route V1. Établies d'après le **code** de `main`, pas d'après la politique de confidentialité. Pour le fondateur.*

*Lot « mesure du parcours » : **un type de plus à cocher**, « Données de performances » (partie 2, Diagnostics) pour les temps d'attente envoyés avec l'accord aux statistiques ⚠️ À vérifier dans la documentation officielle d'Apple. Les nouveaux événements, eux, restent dans « Interaction avec le produit » (partie 6).*

*Remis à jour le 21 novembre 2026 sur le code de `main` (0474313) : vie sociale (compte privé, réponses, mentions, identifications, publications enregistrées, épingles, lien en bio), messages (j'aime, réponses, suppression, « Vu »), fil « Pour vous », notifications d'activité, liens TikTok et Instagram (lecteur officiel dans une vue web, analyse d'un lien, pièces déjà repérées), alertes prix et stock dans leur nouvelle version (en service depuis le 15 novembre 2026), mises à jour à distance d'Expo, part du mois. **Aucun type de donnée nouveau à cocher**, mais deux questions à trancher devant l'écran avant de saisir : le lecteur officiel (partie 6, premier point) et la finalité « Personnalisation du produit » pour « Contacts » (partie 2). Les preuves déjà là depuis le 10 novembre citent des numéros de ligne de l'époque (b99e884) : les fichiers sont les bons, les numéros ont pu glisser ; les preuves ajoutées citent le fichier et le nom à y chercher. Brouillon : rien n'est saisi chez Apple.*

**Où** : App Store Connect → Spotto → **Confidentialité de l'app** (*App Privacy*) → **Commencer**. Apple demande, pour chaque type de donnée : collectée ou non ; liée à l'identité de la personne ou non ; utilisée pour le suivi (*tracking*) ou non ; et à quelles fins.

**Trois définitions d'Apple, pour cocher sans hésiter** (page officielle, relue le 21 novembre 2026 : https://developer.apple.com/app-store/app-privacy-details/) :
- **Collecter** : envoyer une donnée hors de l'iPhone d'une façon qui permet, à vous ou à vos prestataires, d'y accéder plus longtemps que le temps de répondre à la demande. Ce que font vos prestataires (Supabase, Sentry, PostHog, SerpApi, Anthropic…) compte comme si vous le faisiez.
- **Liée à la personne** : rattachée à son compte, à son appareil ou à d'autres détails. Chez Spotto, presque tout est rangé sous le compte : la réponse est « oui » partout où une donnée est collectée.
- **Suivi** (*tracking*) : croiser les données de l'app avec celles d'autres sociétés pour de la publicité ciblée, ou les transmettre à un courtier en données. **Spotto ne fait aucun suivi** : la réponse est « non » partout, sous réserve du lecteur officiel de TikTok et d'Instagram (partie 6).

Et une règle de la même page pour les vues web (le lecteur officiel en est une) : « Data collected via web traffic must be declared, unless you are enabling the user to navigate the open web. »

Une donnée collectée **seulement avec l'accord** de la personne (les statistiques d'usage, l'analyse des vidéos) doit quand même être déclarée : Apple ne dispense que des cas rares, hors de l'usage principal, que Spotto ne remplit pas.

Les libellés français entre parenthèses sont ceux que je crois voir dans App Store Connect en français (à vérifier à l'écran) ; l'ordre est celui d'Apple.

---

## 1. La première question

« Collectez-vous, vous ou vos partenaires tiers, des données à partir de cette app ? » → **Oui**.

---

## 2. Type par type

Légende : ✅ = à cocher ; — = ne pas cocher. **Suivi : non partout** (sous réserve du lecteur officiel, partie 6). Pour chaque type coché, Apple demande les finalités ; « Fonctionnalité de l'app » (*App Functionality*) couvre : se connecter, faire marcher les fonctions, la sécurité, éviter les plantages, l'assistance.

### Coordonnées (*Contact Info*)

| Type | Collecté | Lié | Finalités | Preuve dans le code |
|---|---|---|---|---|
| **Nom** (*Name*) | ✅ | Oui | Fonctionnalité de l'app | Le « nom affiché » du profil est obligatoire et peut être un vrai nom : `apps/backend/supabase/migrations/0001_init_schema.sql:24` (`display_name text not null`), `apps/backend/src/routes/me.ts:19` et `:183` |
| **Adresse e-mail** (*Email Address*) | ✅ | Oui | Fonctionnalité de l'app | Inscription par e-mail et mot de passe : `apps/mobile/src/app/sign-up.tsx:69` ; aucun e-mail publicitaire (le consentement `marketing_email` existe dans la liste, `packages/shared-types/src/index.ts:712`, mais rien dans l'app ne le demande ni ne l'utilise) |
| Numéro de téléphone, adresse postale, autres coordonnées | — | | | Aucun champ dans l'app ni dans la base (`0001_init_schema.sql:22-33`, table `profiles`) |

### Santé et forme, données financières, informations sensibles

Rien à cocher : aucune donnée de ce genre dans le code. Aucun paiement dans l'app.

### Localisation (*Location*)

| Type | Collecté | Preuve |
|---|---|---|
| Position précise | — | Aucune autorisation de localisation (`apps/mobile/app.json`, plugins) ; la position GPS des photos est retirée par le serveur : `apps/backend/src/lib/photos.ts:13` et `:25` |
| Position approximative | — | Le pays de la recherche vient de la langue et de la région réglées sur l'iPhone, pas d'une position : `apps/backend/src/lib/locale.ts:24-28` (les alertes gardent ce pays de recherche, jamais une position : partie 7) ; PostHog ne localise pas l'adresse IP : `apps/mobile/src/lib/analytics.ts:76` ; les adresses IP des journaux du serveur ne servent pas à localiser (`apps/backend/src/lib/logPrivacy.ts:26-27`) |

### Contacts

| Type | Collecté | Lié | Finalités | Preuve |
|---|---|---|---|---|
| **Contacts** | ✅ (conseillé) | Oui | Fonctionnalité de l'app ; **Personnalisation du produit** (conseillé, à vérifier à l'écran) | Spotto ne lit **pas** le carnet d'adresses de l'iPhone. Mais Apple range aussi sous « Contacts » le *social graph* (« Such as a list of contacts in the user's phone, address book, or social graph ») : les abonnés et abonnements de la personne sont enregistrés (`0001_init_schema.sql:35-41`, table `follows`), comme ses demandes d'abonnement (migration 0045), ses comptes bloqués (`apps/backend/src/routes/blocks.ts`), les membres qu'elle identifie ou mentionne (migrations 0046 et 0047). **Depuis le lot « découverte » (migration 0050), ce graphe sert aussi à choisir ce qu'on lui montre** : les comptes à découvrir partent des comptes suivis par ses abonnements, et « Pour vous » écarte les comptes qu'elle suit (`apps/backend/src/lib/forYou.ts`). Apple définit « Product Personalization » ainsi : « Customizing what the user sees, such as a list of recommended products, posts, or suggestions ». D'où les deux finalités conseillées. Cocher « Contacts » n'est plus seulement prudent : c'est la lecture la plus juste. |

### Contenu de l'utilisateur (*User Content*)

| Type | Collecté | Lié | Finalités | Preuve |
|---|---|---|---|---|
| **E-mails ou messages texte** (*Emails or Text Messages*) | ✅ | Oui | Fonctionnalité de l'app | Les messages privés entre membres sont enregistrés sur le serveur : texte (1 000 caractères au plus) et « carte » d'une envie jointe (table `messages`, `apps/backend/supabase/migrations/0032_messages.sql` ; envoi et lecture : `apps/backend/src/routes/conversations.ts`). **Depuis le 19 novembre 2026** (migrations 0043 et 0044) : les « j'aime » des messages, le message auquel on répond, la publication envoyée (jamais recopiée), la mention « Message supprimé » (le contenu d'un message supprimé n'est gardé que s'il avait été signalé, pour la modération), la date de la dernière lecture de chaque conversation et le réglage « Confirmations de lecture » (`apps/backend/src/lib/messageActions.ts`, `apps/backend/src/lib/readReceipts.ts`). Apple, page « App privacy details » : « Declare emails or text messages on your label. Text messages refer to both SMS and non-SMS messages. » Un message signalé est lu par l'administrateur, avec quelques messages autour (`apps/backend/src/lib/moderationQueue.ts`). Ni publicité ni suivi. Les e-mails de la personne ne sont pas lus par l'app. |
| **Photos ou vidéos** (*Photos or Videos*) | ✅ | Oui | Fonctionnalité de l'app | Photos publiées `apps/backend/src/routes/posts.ts:442`, photo de profil `apps/backend/src/routes/me.ts:106`, photos du Vault `apps/backend/src/routes/vault.ts:198` et `:380`, rangées dans le stockage `apps/backend/src/lib/storage.ts:9` ; image analysée envoyée au serveur puis à SerpApi et Google (`apps/backend/src/routes/searches.ts:1028-1054`), y compris l'instantané pris dans le lecteur officiel et la capture reçue de la « Recherche d'image » d'iOS, qui suivent le chemin d'une photo ; jusqu'à 5 photos par publication (migration 0047) ; avec accord, 12 images réduites d'une vidéo du téléphone envoyées à Anthropic (`apps/backend/src/routes/videoMoments.ts:113-160`) ; avec accord et l'analyse d'un lien allumée, 16 images au plus d'une vidéo TikTok ou Instagram publique, récupérée par le service vidéo puis transmise à Anthropic, sans rien garder (`apps/backend/src/routes/videoLinkAnalysis.ts`, `apps/video-worker/README.md`) |
| Données audio | — | | | Micro coupé : `apps/mobile/app.json:92` (`"microphonePermission": false`) ; la vidéo reste sur l'iPhone (`apps/mobile/src/i18n/fr.ts:139`) |
| Contenu de jeu | — | | | — |
| Service client (*Customer Support*) | — | | | Pas de formulaire dans l'app : « Nous contacter » ouvre votre messagerie (`apps/mobile/src/lib/contact.ts:31-33`) ; les e-mails reçus sont hors de l'app |
| **Autre contenu de l'utilisateur** (*Other User Content*) | ✅ | Oui | Fonctionnalité de l'app | Légendes `posts.ts:478-483`, commentaires et leurs réponses, « j'aime » des commentaires, mentions (migration 0046, `apps/backend/src/lib/comments.ts`, `mentions.ts`), personnes identifiées (migration 0047, `apps/backend/src/lib/peopleTags.ts`), publications épinglées et lien affiché sur le profil (migration 0049 : `apps/backend/src/lib/profileExtras.ts`, `apps/backend/src/lib/bioLink.ts`), publications enregistrées, visibles de la seule personne (migration 0048, `apps/backend/src/lib/savedPosts.ts`), bio `me.ts:172-185`, titres des pièces du Vault et des Envies `vault.ts:198`, `apps/backend/src/routes/wishlist.ts:111`, noms des collections d'envies (`apps/backend/src/routes/collections.ts`), précisions d'un signalement `apps/backend/src/routes/reports.ts:41-49`, description d'une vidéo envoyée à Anthropic (avec accord, vidéo du téléphone ou lien) `videoMoments.ts:143-145`, `videoLinkAnalysis.ts` ; voie C allumée : les mots de « Que cherchez-vous ? » et, pour un lien vidéo dont aucun résultat n'affiche de prix, la description du lien, envoyés une fois à SerpApi puis Google sans être enregistrés (`searches.ts:715-718`, `apps/mobile/src/lib/auto-text-search.ts`) |

### Historique de navigation (*Browsing History*)

| Type | Collecté | Preuve |
|---|---|---|
| Historique de navigation | — (conseillé, à vérifier : lecteur officiel) | Spotto enregistre le **clic** sur un lien de marchand (classé plus bas en « Interaction avec le produit »), pas les pages vues ensuite : elles s'ouvrent dans une fenêtre Safari dont l'app ne voit rien (`apps/mobile/src/lib/merchant-links.ts:90-93`). Le lien d'un profil s'ouvre hors de l'app, sans clic enregistré (`apps/mobile/src/components/external-link-sheet.tsx`). L'adresse d'une vidéo TikTok ou Instagram donnée pour une recherche est gardée **avec la recherche** (ligne suivante) : c'est ce que la personne envoie pour chercher. Ce que TikTok et Meta voient par leur lecteur officiel est une question à part (partie 6). |

### Historique des recherches (*Search History*)

| Type | Collecté | Lié | Finalités | Preuve |
|---|---|---|---|---|
| **Historique des recherches** | ✅ | Oui | Fonctionnalité de l'app | Chaque recherche et ses résultats sont rangés sous le compte (`0001_init_schema.sql:44-55`), remontrés dans « Récemment spottées » (`searches.ts:876`), gardés 12 mois (`apps/backend/src/lib/searchRetention.ts:16`). Avec la recherche : l'adresse publique de la vidéo TikTok ou Instagram d'où vient l'image, le cas échéant, et le lien entre la recherche et cette vidéo, qui fait apparaître les pièces trouvées aux autres membres qui ouvrent la même vidéo, sans nom et à partir de 2 membres (migrations 0038 et 0039, `apps/backend/src/lib/videoMemory.ts`). Les recherches servent aussi, sans nom, aux alertes des autres membres (partie 7). |

### Identifiants (*Identifiers*)

| Type | Collecté | Lié | Finalités | Preuve |
|---|---|---|---|---|
| **Identifiant utilisateur** (*User ID*) | ✅ | Oui | Fonctionnalité de l'app ; Analyses | Identifiant du compte (Supabase) ; envoyé à Sentry avec les erreurs (`apps/mobile/src/lib/error-tracking.ts:45-47`, `apps/backend/src/lib/sentry.ts:64` et `:74`) et à PostHog avec les statistiques acceptées (`apps/mobile/src/lib/analytics.ts:69`) ; le nom d'utilisateur public est aussi un identifiant |
| **Identifiant de l'appareil** (*Device ID*) | ✅ (conseillé, par prudence) | Oui | Fonctionnalité de l'app | Aucun identifiant publicitaire (IDFA). Mais un plantage de l'app iPhone part à Sentry avec un identifiant d'installation pseudonyme, comme le dit la politique (`apps/mobile/src/legal/confidentialite.ts:51`) ; le nettoyage ne retire que `device_app_hash` (`apps/mobile/src/lib/sentry-scrub.ts:22-27`). Depuis les notifications (migration 0035) : l'adresse de notification de l'iPhone (jeton donné par Expo), enregistrée quand la personne active les notifications, avec ce que l'appareil reçoit (messages, alertes et, depuis la migration 0051, quatre sortes d'activité), effacée quand elle les coupe toutes ou se déconnecte (`apps/backend/src/lib/push.ts`, table `push_tokens`). Depuis le 17 novembre 2026, la vérification des mises à jour à distance envoie aussi à Expo un identifiant d'installation tiré au hasard (partie 4, ligne « Expo (mises à jour à distance) »). Cocher n'ajoute rien de visible sur la fiche : la rubrique « Identifiants » y figure déjà. |

### Achats (*Purchases*)

| Type | Collecté | Lié | Finalités | Preuve |
|---|---|---|---|---|
| **Historique des achats** (*Purchase History*) | ✅ (conseillé, par prudence) | Oui | Fonctionnalité de l'app | Aucun achat dans l'app. Mais le Vault enregistre les pièces que la personne dit avoir achetées (« Je l'ai achetée », `apps/mobile/src/i18n/fr.ts`, `result.markAsBought` ; publications « achat », `0001_init_schema.sql:13`) : c'est une « tendance d'achat » au sens d'Apple. Le statut d'abonnement prévu par la migration 0053 (type, date de fin, source) n'est écrit par rien aujourd'hui, et les abonnements sont coupés (`SUBSCRIPTIONS_ENABLED`) : rien de plus à cocher (partie 6). |

### Données d'utilisation (*Usage Data*)

| Type | Collecté | Lié | Finalités | Preuve |
|---|---|---|---|---|
| **Interaction avec le produit** (*Product Interaction*) | ✅ | Oui | Analyses ; Fonctionnalité de l'app (à ajouter, partie 7) | Avec accord seulement : événements d'usage envoyés à PostHog (`apps/mobile/src/lib/analytics-events.ts`, dont l'ouverture de l'app, et depuis novembre `post_saved`, `for_you_opened`, les événements du lecteur et de l'analyse d'un lien, et avec le lot « mesure du parcours » les étapes du parcours (`journey_started`, `plan_b_screenshot_chosen`, `first_search_guide`, la mention de l'offre au clic vers une boutique `merchant_link_opened.mark`, la plateforme du lien `link_platform`), jamais le lien, les mots ni les images ; envoi `apps/mobile/src/lib/analytics.ts`, coupé sans accord). Même sans accord : chaque clic vers un marchand est enregistré sous le compte, avec l'identification du navigateur (*user agent*) (`apps/backend/src/routes/productMatches.ts`, table `0001_init_schema.sql:88-95`), pour mesurer les pièces qui intéressent (politique, « Vos clics vers les marchands ») ; les « C'est bien cette pièce » sont gardés avec le compte, pour n'être comptés qu'une fois (`apps/backend/src/lib/videoMemory.ts`) ; les cloches et signalements des alertes : partie 7 |
| Données publicitaires | — | | | Aucune publicité |
| Autres données d'utilisation | — | | | — |

### Diagnostics

| Type | Collecté | Lié | Finalités | Preuve |
|---|---|---|---|---|
| **Données de plantage** (*Crash Data*) | ✅ | Oui | Fonctionnalité de l'app | Sentry signale les plantages de l'app iPhone (`apps/mobile/src/lib/error-tracking.ts:9` et `:21-41`), avec l'identifiant du compte (`:45-47`) |
| **Données de performances** (*Performance Data*) ⚠️ À vérifier dans la documentation officielle d'Apple | ✅ | Oui | Analyses (à confirmer à l'écran) | Lot « mesure du parcours », avec accord seulement : des temps d'attente envoyés à PostHog avec l'identifiant interne du compte (`apps/mobile/src/lib/analytics.ts:69`), jamais pour le suivi. La première réponse du serveur à chaque lancement ou retour dans l'app (`server_first_response`, `wait_ms`), l'attente des résultats d'une recherche et d'une analyse (`wait_ms` et `shops_wait_ms` de `spot_completed`, `wait_ms` de `text_search_completed`, `video_ai_result` et `video_link_ai_result`) : `apps/mobile/src/lib/analytics-events.ts`. Une durée en millisecondes seulement, jamais une heure, un lien ni une recherche. Note : Sentry, lui, ne mesure toujours pas les performances (`error-tracking.ts:31-34`, `tracesSampleRate: 0` ; `apps/backend/src/lib/sentry.ts:52`) |
| **Autres données de diagnostic** (*Other Diagnostic Data*) | ✅ | Oui | Fonctionnalité de l'app | Erreurs rattrapées par l'app (`error-tracking.ts:51-53`) et erreurs du serveur (`apps/backend/src/lib/sentry.ts:61-77`), avec l'identifiant du compte ; type de navigateur ou modèle de téléphone et version du système (politique `confidentialite.ts:51`) |

### Environnement, Corps

Rien à cocher (types réservés à l'Apple Vision Pro).

### Autres données (*Other Data*)

| Type | Collecté | Lié | Finalités | Preuve |
|---|---|---|---|---|
| **Autres types de données** | ✅ | Oui | Fonctionnalité de l'app | La déclaration « j'ai au moins 15 ans » et les accords datés (conditions, politique, statistiques, analyse des vidéos dans sa version qui couvre les liens) : `CONSENT_VERSIONS` (`packages/shared-types/src/index.ts`), enregistrés par `apps/backend/src/routes/account.ts`. L'accord pour le lecteur officiel reste sur l'iPhone (`apps/mobile/src/lib/player-access.ts`) : il n'est pas collecté. |

---

## 3. Le résumé que verront les gens sur la fiche

Avec ces réponses, la fiche affichera :
- **Données utilisées pour vous suivre** : aucune.
- **Données liées à vous** : Achats, Coordonnées, Contacts, Contenu de l'utilisateur, Historique des recherches, Identifiants, Données d'utilisation, Diagnostics, Autres données.
- **Données non liées à vous** : aucune.

Sous réserve du lecteur officiel (partie 6) : si vous décidez d'y déclarer ce que TikTok et Meta collectent, ce résumé peut changer, et « Données utilisées pour vous suivre » aussi.

---

## 4. Qui reçoit quoi (pour vérifier les réponses)

| Prestataire | Ce qu'il reçoit | Preuve |
|---|---|---|
| **Supabase** (base, stockage des photos, comptes) | tout ce qui est rangé sous le compte | `apps/backend/src/env.ts:8-9`, `apps/backend/src/lib/storage.ts:9` |
| **Render** (serveur, service vidéo et site) | chaque requête, avec l'adresse IP, dans ses journaux ; jamais les mots tapés, un e-mail ni un identifiant de compte dans ces journaux. Le service vidéo, privé, ne reçoit du serveur que l'adresse de la vidéo à analyser, et n'écrit rien sur disque | `apps/backend/src/lib/logPrivacy.ts`, `apps/video-worker/README.md` |
| **SerpApi, puis Google** (Lens, Google Shopping) | un lien temporaire vers l'image recadrée ; voie C allumée : la courte recherche écrite par l'IA, les mots de « Que cherchez-vous ? » et, pour un lien vidéo dont aucun résultat n'affiche de prix, sa description (ou le nom de la pièce choisie parmi les propositions de l'IA) ; jamais le compte | `apps/backend/src/routes/searches.ts`, `apps/mobile/src/lib/auto-text-search.ts` |
| **Anthropic** (IA) | avec accord : 12 images réduites d'une vidéo du téléphone, ou 16 images au plus d'une vidéo TikTok ou Instagram (analyse d'un lien allumée), et la description, sauf pour les propositions de l'IA (`VIDEO_PIECES_ENABLED` : les images seules ; l'IA renvoie le nom de 3 pièces au plus, jamais gardé) ; voie C allumée (avec son IA) : les titres et sites des 15 premiers résultats, jamais d'image | `apps/backend/src/routes/videoMoments.ts`, `apps/backend/src/routes/videoLinkAnalysis.ts`, `apps/backend/src/services/shoppingQueryAi.ts`, `apps/backend/src/lib/aiSwitches.ts` |
| **Sentry** (erreurs) | rapports d'erreur et de plantage, avec l'identifiant du compte, sans nom, e-mail ni contenu | `apps/mobile/src/lib/sentry-scrub.ts:10-28`, `apps/backend/src/lib/sentry.ts:30-56` |
| **PostHog** (statistiques) | avec accord seulement : des événements d'une liste fermée, avec l'identifiant du compte, sans cookie ; depuis le lot « mesure du parcours », aussi des temps d'attente (partie 2, « Données de performances ») | `apps/mobile/src/lib/analytics.ts:1-12`, `apps/mobile/src/lib/analytics-events.ts:1-6` |
| **Expo, puis Apple** (notifications sur l'iPhone) | seulement si `PUSH_ENABLED` est allumé chez Render ET si la personne a activé les notifications : l'adresse de notification de son iPhone (jeton) et le texte de la notification. Pour un message : le nom de l'app, « Nouveau message de @pseudo » ou « Invitation de @pseudo », et l'identifiant de la conversation ; **jamais** le texte du message ni l'envie jointe. Pour une alerte : une phrase générique (« Baisse de prix sur l'une de vos Envies »…) et l'identifiant de l'envie (aucun pour une notification groupée) ; **jamais** le titre de la pièce, la boutique ni le prix (nouvelle version des alertes, migration 0041). Pour une notification d'activité (migration 0051, si la personne a allumé cette sorte) : le nom de l'app, une phrase fixe avec le nom d'utilisateur du membre (« @pseudo a aimé votre publication »…) et l'identifiant de la publication ou du membre (aucun pour une demande d'abonnement, qui ouvre la liste des demandes) ; **jamais** le texte d'un commentaire, une légende ni une image. | `apps/backend/src/lib/push.ts:1-16`, `apps/backend/src/lib/wishAlertsSend.ts`, `apps/backend/src/lib/notify.ts`, `apps/backend/src/env.ts:64` |
| **Expo** (mises à jour à distance) | depuis le 17 novembre 2026 (`updates.url` dans `apps/mobile/app.json`, vérification à chaque lancement) : chaque iPhone demande aux serveurs d'Expo s'il existe une mise à jour, avec son adresse IP, la version de l'app et un identifiant d'installation tiré au hasard (en-tête `EAS-Client-ID`, ajouté par la bibliothèque `expo-updates`) ; aucun identifiant de compte. Ce qu'Expo en garde, et pour quoi : à vérifier (« Identifiant de l'appareil » est déjà coché, partie 2). Expo n'est pas cité pour cela dans la politique (partie 5, point 4) | `apps/mobile/app.json` (`updates`), `apps/mobile/BUILD-IPHONE.md`, section 1, `expo-updates` (`FileDownloader.swift`) |
| **Cloudflare** (protection anti-robots Turnstile) | seulement si elle est activée (clé `EXPO_PUBLIC_TURNSTILE_SITE_KEY` dans le build, et réglage dans Supabase) : l'adresse IP et des données techniques de l'appareil, à la connexion et à l'inscription | `apps/mobile/ANTI-ROBOTS.md` |
| **Service d'envoi des e-mails** (confirmation, mot de passe oublié), réglé dans Supabase | les adresses e-mail des membres | réglage hors du code (Supabase → Authentication → Emails → SMTP) |
| **TikTok, Meta** | depuis nos serveurs, seulement l'adresse de la vidéo, jamais l'identité ni l'adresse IP de la personne : le serveur demande à TikTok vers où mène un lien court, et à Meta le code d'intégration d'une publication Instagram (gardé 24 heures) ; analyse d'un lien allumée et acceptée : le service vidéo leur demande la vidéo publique. **Dans l'app**, si le lecteur officiel est dans le build et que la personne l'accepte : il est chargé directement chez TikTok (`www.tiktok.com/player/v1/…`) ou chez Meta (`embed.js`), qui reçoivent l'adresse IP et les informations techniques de l'iPhone, et peuvent déposer leurs propres traceurs (politique, section « Vidéos… ») | `apps/backend/src/routes/videoLinks.ts` (en-tête), `apps/backend/src/lib/videoLinks.ts`, `apps/backend/src/lib/instagramEmbed.ts`, `apps/video-worker/README.md`, `apps/mobile/src/lib/player-host-page.ts`, test `apps/backend/tests/aucunMediaTiktokInstagram.test.ts` |
| **Sites des marchands et Google** (images affichées) | l'adresse IP de l'iPhone, quand l'app affiche leurs images ou ouvre leur page | politique `confidentialite.ts:98` |

---

## 5. Différences entre le code et la politique de confidentialité

La politique n'est **pas** modifiée ici (les textes légaux ne font pas partie de ce dossier). Voici les écarts relevés, pour sa prochaine version (état au 21 novembre 2026) :

1. **Suppression après 3 ans sans connexion, avec un e-mail d'avertissement** (`apps/mobile/src/legal/confidentialite.ts:129`) : **rien n'est codé** (aucun « inactiv » dans `apps/backend/src`). Rien n'est dû avant 2029, mais la promesse est écrite.
2. **TikTok et Meta** : **réglé.** Depuis sa mise à jour du 15 novembre 2026, la politique décrit ce que fait le code : le lien court TikTok suivi par le serveur, le code d'intégration d'Instagram demandé à Meta, le lecteur officiel (avec accord), l'analyse d'un lien par le service vidéo, les pièces déjà repérées (section « Vidéos de votre téléphone, de TikTok et d'Instagram »).
3. **Le Vault comme historique d'achats, les abonnements comme « contacts »** : la politique les décrit bien (`confidentialite.ts:44` et `:46`) ; c'est seulement Apple qui les range sous ces noms. Rien à changer.
4. **Expo (mises à jour à distance)** : **en service depuis le 17 novembre 2026** (`updates.url` dans `apps/mobile/app.json`, vérification à chaque lancement). Chaque iPhone interroge les serveurs d'Expo au lancement (adresse IP, version de l'app, identifiant d'installation tiré au hasard : partie 4). La politique ne cite Expo que pour les notifications (section « Nos prestataires et les services tiers »).
5. **Le service d'envoi des e-mails de connexion** (confirmation, mot de passe oublié), réglé dans Supabase : il reçoit les adresses e-mail et n'est pas cité (point 3 et point 7 de la feuille de route).
6. **« Hébergées en Irlande »** (`confidentialite.ts:90`) et durées de conservation de Render, Sentry et PostHog (`:130-131`, encore « [À vérifier] ») : impossible à vérifier depuis le code.
7. **« L'image analysée est supprimée dès le résultat »** (`confidentialite.ts:25` et `:123`) : vrai dans le cas normal ; après un plantage, une image restée est maintenant effacée au bout d'une heure, lors d'une recherche suivante (`apps/backend/src/routes/searches.ts:990-1000`, `apps/backend/src/lib/storage.ts:152`). « Quelques secondes » reste vrai dans le cas normal seulement.

**Ajoutés le 10 novembre 2026, d'après l'audit App Store (ce sont des notes : les textes légaux n'ont pas été modifiés) :**

8. **La copie de sécurité hebdomadaire des photos** (`apps/backend/supabase/SAUVEGARDE-PHOTOS.md`) n'est pas dans la politique : ni l'endroit où elle est gardée, ni sa durée (une photo effacée y reste 7 jours au plus).
9. **Les phrases sur la suppression du compte sont trop absolues.** L'app et la politique disent un effacement immédiat et définitif. En réalité : la copie de sécurité des photos vit jusqu'à 7 jours ; les sauvegardes de la base (selon l'offre Supabase) gardent les données le temps de leur rotation ; les rapports d'erreur déjà partis chez Sentry et les statistiques déjà parties chez PostHog y restent le temps de leur conservation. Formulation exacte : à arrêter avant la publication des textes. La phrase de confirmation dans l'app (`apps/mobile/src/i18n/fr.ts`, section du compte) reste à corriger une fois le texte arrêté.
10. **Cloudflare** : si la protection anti-robots est activée, c'est un prestataire de plus, absent de la politique (décision G de l'audit).
11. **Notifications des messages** : elles passent par Expo puis Apple (voir partie 4). La politique en parle dans un passage encore marqué « [À vérifier] » (rôle d'Expo, base légale).
12. **Messages privés** : la politique les décrit, avec des points encore « [À vérifier] » (base légale, durée de conservation, information de la personne invitée, mention « Vu » activée par défaut). Deux faits du code à lui donner : quand un membre supprime son compte, la conversation disparaît aussi pour l'autre personne (décision F de l'audit) ; un message signalé est lu par l'administrateur avec quelques messages autour.
13. **La photo envoyée à Google Lens** (par SerpApi) : annoncée dans la politique, acceptée d'une case à l'inscription ; rien à l'écran au moment du premier envoi. La règle 5.1.2 (i) d'Apple demande un accord explicite avant un partage avec un tiers, IA tierce comprise (décision A de l'audit : un écran d'accord, sur le modèle de celui des vidéos).
14. **La phrase exigée par Apple sur les tiers** (règle 5.1.1 (i) : protection « identique ou équivalente » chez chaque prestataire) n'est pas écrite en toutes lettres ; la politique note elle-même que Google reçoit l'image « sans contrat direct avec l'éditeur ».
15. **Sans accord** : les rapports d'erreur (Sentry), les clics vers les marchands et les titres de résultats envoyés à l'IA des « autres boutiques » reposent sur l'intérêt légitime, d'après la politique, qui marque ces points « [À vérifier] » (décision H de l'audit).
16. **Alertes prix et stock** (nouvelle version, migration 0041) : les recherches et les signalements « Plus disponible » des autres membres servent à prévenir, sans dire qui, tant que leur réglage « Aider les autres membres » reste allumé (il l'est par défaut) ; un achat « Je l'ai achetée » ne sert plus aux alertes des autres. La politique le dit, avec « [À vérifier : base retenue, et réglage activé par défaut.] » : cet usage est-il couvert par la finalité d'origine ? Règle 5.1.2 (ii) d'Apple : « Data collected for one purpose may not be repurposed without further consent unless otherwise explicitly permitted by law. »
17. **Les 15-17 ans** : une case « au moins 15 ans », sans contrôle ; mêmes réglages pour tous, dont « Qui peut m'écrire : tout le monde » et « Proposer mon compte aux autres membres » allumé par défaut : les publications publiques d'un mineur peuvent être proposées dans « Pour vous » à des inconnus (décision C de l'audit ; règle 5.1.4 d'Apple).
18. **Modération des profils** (lot « conformité Apple ») : un administrateur peut maintenant retirer une bio ou une photo de profil, et la bio et la photo d'un compte suspendu ne sont plus montrées aux autres membres. Les conditions d'utilisation ne citent, dans « Signaler, bloquer, modérer », que la publication, le commentaire et le compte : à compléter (messages, pièces reçues, collections, bio et photo), avec les deux « [À compléter] » déjà signalés (délais de traitement, procédure de suspension).
19. **Le manifeste de confidentialité de l'app** (`apps/mobile/app.json`, `ios.privacyManifests`) déclare les fonctions sensibles du système, pas encore la liste des types de données collectées ni « suivi : non ». À aligner sur cette déclaration une fois vos réponses arrêtées (travail de code, non fait ici).
20. **Les versions des deux textes sont encore « projet-… »** (`LEGAL_DOCUMENT_VERSIONS` : conditions « projet-2026-09-25 », politique « projet-2026-11-05 », alors que la politique a changé depuis, les 15, 17, 18 et 19 novembre, sans changer de version) : l'app affiche le bandeau « Projet — à faire valider par un professionnel », et les textes gardent des passages entre crochets. Apple refuse tout texte provisoire (règle 2.1 (a)) ; le contrôle du build arrête désormais un build `production` tant qu'il reste des crochets (`apps/mobile/scripts/verifier-build.js`).

Rien d'autre : les statistiques avec accord et sans cookie, les rapports d'erreur sans nom ni e-mail, les clics avec le *user agent*, l'historique de 12 mois, la vidéo du téléphone qui reste sur l'iPhone, les 12 images réduites (16 pour un lien), « Vu » sans l'heure de la lecture, « Pour vous » sans profil, la part du mois recalculée sans compteur sont conformes au code.

---

## 6. Quand revoir ces réponses

**À trancher avant le premier envoi : le lecteur officiel TikTok / Instagram.** Il est revenu (mission « liens vidéo ») et il est **dans le build par défaut** (options du build allumées : `apps/mobile/BUILD-IPHONE.md`, section 9). C'est une vue web qui charge, après l'accord de la personne, le lecteur de TikTok (`www.tiktok.com/player/v1/…`) ou le code d'intégration d'Instagram (`embed.js`) ; d'après la politique, TikTok et Meta reçoivent alors l'adresse IP et les informations techniques de l'iPhone, et peuvent déposer leurs propres traceurs. La vue ne laisse pas naviguer librement : un lien du lecteur n'ouvre rien (`apps/mobile/src/components/embedded-player.tsx`). Or Apple écrit : « Data collected via web traffic must be declared, unless you are enabling the user to navigate the open web. » Ce que TikTok et Meta collectent par ce lecteur entre donc, a priori, dans votre déclaration. **À vérifier** : quels types cocher en plus (des identifiants ? des données d'utilisation ?), et surtout « Suivi » : si leurs traceurs servent à la publicité ciblée, la réponse devient « oui », et la règle 5.1.2 (i) d'Apple s'applique : « You must receive explicit permission from users via the App Tracking Transparency APIs to track their activity. » L'app ne demande pas cette autorisation aujourd'hui. Si le doute reste, le plus sûr est un build sans lecteur (les deux options à `false` chez Expo) : ces questions disparaissent, et les notes pour Apple restent justes (lecteur « OFF »).

Ensuite, avant chaque build envoyé à Apple, si l'un de ces changements est entré dans `main` :
- le **service anti-robots** (point 17) : il reçoit l'adresse IP et des données de l'appareil (partie 4, ligne Cloudflare) ;
- la **copie des photos** pour les sauvegardes (point 10) ;
- tout nouveau prestataire, toute nouvelle autorisation, tout nouvel événement de statistiques ;
- les **notifications** (`PUSH_ENABLED`) : dès qu'elles sont allumées, la ligne « Expo, puis Apple » (partie 4) s'applique. Les **alertes prix et stock**, elles, sont en service depuis le 15 novembre 2026 (migrations 0036, 0040, 0041) : les réponses de la partie 7 valent déjà, notifications allumées ou non ;
- un **écran d'accord pour la photo envoyée à Google Lens**, s'il est décidé : il ne change pas les types de données, mais la politique et les notes pour Apple.
- le **lien en bio** (lot « vie sociale », migration 0049) : c'est du « Contenu de l'utilisateur », comme la bio (ligne « Autre contenu de l'utilisateur » ci-dessus) ; aucun type nouveau. L'app n'enregistre aucun clic sur ce lien et ne le réécrit pas (pas d'affiliation) : rien à ajouter en « Historique de navigation » ni en « Interaction avec le produit ». À revoir si un jour des statistiques de clics ou un aperçu des liens étaient ajoutés.
- les **notifications d'activité** (lot « découverte », migration 0051) : quatre interrupteurs par appareil (« j'aime », commentaires, abonnés, mentions), éteints au départ, proposés une fois dans l'onglet Activité ; la notification passe par Expo puis Apple (partie 4, ligne « Expo, puis Apple ») et ne contient que le nom d'utilisateur du membre, une phrase fixe et l'identifiant de la publication ou du membre (aucun pour une demande d'abonnement). Aucun type de donnée nouveau : l'adresse de notification de l'appareil (« Identifiant de l'appareil ») est déjà déclarée, et ses quatre réponses sont gardées avec elle (`apps/backend/src/lib/push.ts`) ; aucun événement de statistiques, rien à ajouter en « Suivi ». Ne s'applique que si `PUSH_ENABLED` est allumé (0051 est appliquée depuis le 20 novembre 2026).
- le **fil « Pour vous » et les comptes à découvrir** (lot « découverte », migration 0050) : un nouvel événement de statistiques, `for_you_opened`, sans aucune propriété (ni publication vue, ni durée), envoyé avec accord seulement, déjà couvert par « Interaction avec le produit » (Analyses) ; le contexte « suggestion » s'ajoute à `follow_added` (`apps/mobile/src/lib/analytics-events.ts`). Rien n'est enregistré de ce qui est vu et aucun profil des centres d'intérêt n'est calculé : le classement est le même pour tous (`apps/backend/src/lib/forYou.ts`). Le réglage « Proposer mon compte aux autres membres » est une colonne du profil. Aucun type de donnée nouveau, rien à ajouter en « Suivi ». Une finalité en plus, en revanche : les comptes à découvrir partent des comptes suivis par vos abonnements, ce qu'Apple appelle « Personnalisation du produit » (partie 2, ligne « Contacts »). Les publications de membres inconnus restent signalables et leurs auteurs bloquables depuis le fil (règle 1.2).
- l'**analyse d'un lien** (`VIDEO_LINK_ANALYSIS_ENABLED`, coupée par défaut) : déjà couverte par « Photos ou vidéos » et « Autre contenu de l'utilisateur » (partie 2) ; allumée, elle ajoute le service vidéo (Render) et une demande de la vidéo publique à TikTok ou à Meta, sans l'identité de la personne (partie 4).
- les **propositions de l'IA** (`VIDEO_PIECES_ENABLED`, coupées par défaut, lot « propositions ») : **aucun type de donnée nouveau**. C'est le même appel à Anthropic que l'analyse d'un lien, avec les mêmes images et sans aucun texte de la personne (« Photos ou vidéos », partie 2) ; l'IA renvoie le nom de 3 pièces au plus, montré à la seule personne qui a demandé et gardé nulle part (ni base, ni journaux, ni Sentry, ni statistiques : `apps/backend/src/services/videoMoments.ts`, `askVideoPieces`). Le nom de la pièce choisie suit le chemin d'une description tapée (tri, puis Google Shopping par SerpApi si rien n'a de prix ; jamais enregistré). Statistiques : une propriété de plus, `mode` (`words` ou `pieces`), dans « Interaction avec le produit » (Analyses), jamais un nom (`apps/mobile/src/lib/analytics-events.ts`).
- les **abonnements** (`SUBSCRIPTIONS_ENABLED`, coupés ; rien n'écrit le statut d'abonnement aujourd'hui) : le jour où ils existent, revoir « Historique des achats » (le statut d'abonnement), les achats intégrés et les notes pour Apple.
- les **mises à jour à distance** (Expo) : la ligne de la partie 4 ; et une mise à jour à distance ne doit jamais changer les données collectées (`apps/mobile/BUILD-IPHONE.md`, section 6).
- le **lot « mesure du parcours »** (statistiques d'usage, avec accord seulement) : de nouveaux événements (`journey_started`, `server_first_response`, `plan_b_screenshot_chosen`, `first_search_guide`), la mention de l'offre au clic vers une boutique (`merchant_link_opened.mark`), la plateforme du lien (`link_platform`) et des temps d'attente (`wait_ms`, `shops_wait_ms`), sans lien, mot tapé ni identifiant de recherche (`apps/mobile/src/lib/analytics-events.ts`, mode d'emploi `apps/mobile/STATISTIQUES.md`). Les événements restent dans « Interaction avec le produit » (Analyses) ; les temps d'attente ajoutent **« Données de performances »** (partie 2, Diagnostics : liées, Analyses, pas de suivi) ⚠️ À vérifier dans la documentation officielle d'Apple. Le résumé de la fiche ne change pas : « Diagnostics » y figure déjà.

---

## 7. BROUILLON — alertes prix et stock (en service depuis le 15 novembre 2026) — à vérifier à l'écran

*Ajouté le 9 novembre 2026, repris le 21 novembre 2026 pour la nouvelle version des alertes (migrations 0036, 0040 et 0041, appliquées en production le 15 novembre 2026 : `apps/backend/supabase/REGISTRE-MIGRATIONS.md`). **Ces réponses valent pour le build envoyé à Apple** : la cloche, l'interrupteur et « Plus disponible » sont visibles dans l'app, que `PUSH_ENABLED` soit allumé ou non. « Brouillon » parce que la colonne « à vérifier » reste : ce sont des questions de classement dans les cases d'Apple, à trancher devant l'écran d'App Store Connect, avec la page officielle d'Apple.*

**Ce que les alertes enregistrent** (d'après le code et la section « Alertes prix et stock » de la politique) :
- la cloche d'une envie (baisse de prix, retour en stock), avec un seuil de prix choisi par la personne, ou à défaut le dernier prix vu, sa devise et son pays, jusqu'à ce que la cloche soit éteinte ou l'envie retirée ; l'interrupteur « Alertes prix et stock » des Réglages, coupé par défaut ; le réglage « Aider les autres membres », allumé par défaut et gardé avec le profil (migrations 0036 et 0041) ;
- pour suivre une envie : une empreinte de la pièce (jamais son lien), le dernier prix vu (devise, pays de la recherche), l'état du stock et leurs dates au jour près ; **aucun nom de boutique** (table `wish_tracking`) ;
- les alertes (sorte, ancien et nouveau prix, jour de création et jour d'envoi ; l'heure exacte n'existe que pendant l'envoi), effacées au bout de 30 jours, sans jamais l'auteur de la recherche ni l'auteur d'un signalement ;
- les signalements « Plus disponible » (qui a signalé, empreinte de la pièce, jour, pays de la recherche, s'il aidait alors les autres membres, s'il fait partie de la série en cours), effacés au bout de 30 jours ; une pièce n'est notée épuisée chez les autres qu'après les signalements de 3 membres différents d'affilée, depuis le même pays ;
- les résultats des recherches et les signalements des membres qui laissent « Aider les autres membres » allumé servent aussi à prévenir d'AUTRES membres, sans jamais dire qui ; **un achat « Je l'ai achetée » ne sert plus aux alertes des autres** (seulement aux envies de la personne elle-même) ;
- une notification d'alerte, si `PUSH_ENABLED` est allumé et que la personne l'a activée sur cet iPhone, passe par Expo puis Apple : une phrase générique et l'identifiant de l'envie (aucun pour une notification groupée), jamais la pièce, la boutique ni le prix ; 5 alertes par jour au plus.

**Effet attendu sur les réponses** (suivi : toujours **non**) :

| Type d'Apple | Déjà coché ? | Changement proposé | Finalités | À vérifier |
|---|---|---|---|---|
| **Achats → Historique des achats** (*Purchases → Purchase History*) | ✅ (Vault) | Rien de plus : depuis la nouvelle version, un achat « Je l'ai achetée » ne sert qu'aux envies de la personne elle-même | Fonctionnalité de l'app | — |
| **Données d'utilisation → Interaction avec le produit** (*Usage Data → Product Interaction*) | ✅ (Analyses) | **Ajouter la finalité « Fonctionnalité de l'app »** : cloches et seuils, interrupteurs des alertes et « Aider les autres membres », signalements « Plus disponible », rangés sous le compte | Analyses ; Fonctionnalité de l'app | à vérifier : ou bien « Autres données d'utilisation » (*Other Usage Data*) |
| **Historique des recherches** (*Search History*) | ✅ | Rien à cocher de plus : les résultats servent aussi aux alertes des autres membres, sans l'auteur de la recherche, sauf si son réglage « Aider les autres membres » est éteint | Fonctionnalité de l'app | à vérifier |
| **Identifiants → Identifiant de l'appareil** (*Identifiers → Device ID*) | ✅ (par prudence) | Rien à cocher de plus : l'adresse de notification de l'appareil (jeton Expo) peut rester pour les seules alertes | Fonctionnalité de l'app | à vérifier : Apple range-t-il le jeton de notification sous « Device ID » ? |
| Liée à la personne | Oui | Inchangé : tout est rangé sous le compte | — | — |
| Suivi (*Tracking*) | Non | Inchangé : aucune donnée des alertes n'est croisée avec d'autres sociétés ni utilisée pour de la publicité | — | — |

**Résumé de la fiche** : a priori inchangé (« Achats » et « Données d'utilisation » y figurent déjà dans « Données liées à vous ») — à vérifier une fois les réponses saisies.

**Qui reçoit quoi, en plus** : Expo, puis Apple — voir la partie 4 : une phrase générique et l'identifiant de l'envie ; jamais un autre membre (`apps/backend/src/lib/wishAlertsSend.ts`, `apps/backend/src/lib/push.ts`, `sendPush`).

**Politique de confidentialité** : la section « Alertes prix et stock » décrit cette nouvelle version (mise à jour du 15 novembre 2026), avec ses passages « [À vérifier] » ; la version (`LEGAL_DOCUMENT_VERSIONS`) n'a **pas** été changée (partie 5, point 20).
