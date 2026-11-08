# Les réponses « App Privacy » (la déclaration de confidentialité d'App Store Connect)

*Chantier 8, point 8 de la feuille de route V1. Établies d'après le **code** de `main` (b99e884), pas d'après la politique de confidentialité. Pour le fondateur.*

**Où** : App Store Connect → Spotto → **Confidentialité de l'app** (*App Privacy*) → **Commencer**. Apple demande, pour chaque type de donnée : collectée ou non ; liée à l'identité de la personne ou non ; utilisée pour le suivi (*tracking*) ou non ; et à quelles fins.

**Trois définitions d'Apple, pour cocher sans hésiter** (page officielle : https://developer.apple.com/app-store/app-privacy-details/) :
- **Collecter** : envoyer une donnée hors de l'iPhone d'une façon qui permet, à vous ou à vos prestataires, d'y accéder plus longtemps que le temps de répondre à la demande. Ce que font vos prestataires (Supabase, Sentry, PostHog, SerpApi, Anthropic…) compte comme si vous le faisiez.
- **Liée à la personne** : rattachée à son compte, à son appareil ou à d'autres détails. Chez Spotto, presque tout est rangé sous le compte : la réponse est « oui » partout où une donnée est collectée.
- **Suivi** (*tracking*) : croiser les données de l'app avec celles d'autres sociétés pour de la publicité ciblée, ou les transmettre à un courtier en données. **Spotto ne fait aucun suivi** : la réponse est « non » partout.

Une donnée collectée **seulement avec l'accord** de la personne (les statistiques d'usage, l'analyse des vidéos) doit quand même être déclarée : Apple ne dispense que des cas rares, hors de l'usage principal, que Spotto ne remplit pas.

Les libellés français entre parenthèses sont ceux que je crois voir dans App Store Connect en français (à vérifier à l'écran) ; l'ordre est celui d'Apple.

---

## 1. La première question

« Collectez-vous, vous ou vos partenaires tiers, des données à partir de cette app ? » → **Oui**.

---

## 2. Type par type

Légende : ✅ = à cocher ; — = ne pas cocher. **Suivi : non partout.** Pour chaque type coché, Apple demande les finalités ; « Fonctionnalité de l'app » (*App Functionality*) couvre : se connecter, faire marcher les fonctions, la sécurité, éviter les plantages, l'assistance.

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
| Position approximative | — | Le pays de la recherche vient de la langue et de la région réglées sur l'iPhone, pas d'une position : `apps/backend/src/lib/locale.ts:24-28` ; PostHog ne localise pas l'adresse IP : `apps/mobile/src/lib/analytics.ts:76` ; les adresses IP des journaux du serveur ne servent pas à localiser (`apps/backend/src/lib/logPrivacy.ts:26-27`) |

### Contacts

| Type | Collecté | Lié | Finalités | Preuve |
|---|---|---|---|---|
| **Contacts** | ✅ (conseillé, par prudence) | Oui | Fonctionnalité de l'app | Spotto ne lit **pas** le carnet d'adresses de l'iPhone. Mais Apple range aussi sous « Contacts » le *social graph* (le graphe social) : les abonnés et abonnements de la personne sont enregistrés (`0001_init_schema.sql:35-41`, table `follows`), comme ses comptes bloqués (`apps/backend/src/routes/blocks.ts:29-30`). **À votre choix** : cocher « Contacts » est le plus prudent ; ne pas le cocher se défend aussi (la liste naît dans Spotto, elle n'est pas importée). |

### Contenu de l'utilisateur (*User Content*)

| Type | Collecté | Lié | Finalités | Preuve |
|---|---|---|---|---|
| E-mails ou messages texte | — | | | Aucune messagerie : l'envoi d'une pièce à quelqu'un n'a pas de texte libre (`apps/backend/supabase/migrations/0024_partage_envies.sql:57-72`) |
| **Photos ou vidéos** (*Photos or Videos*) | ✅ | Oui | Fonctionnalité de l'app | Photos publiées `apps/backend/src/routes/posts.ts:442`, photo de profil `apps/backend/src/routes/me.ts:106`, photos du Vault `apps/backend/src/routes/vault.ts:198` et `:380`, rangées dans le stockage `apps/backend/src/lib/storage.ts:9` ; image analysée envoyée au serveur puis à SerpApi et Google (`apps/backend/src/routes/searches.ts:1028-1054`) ; avec accord, 12 images réduites d'une vidéo envoyées à Anthropic (`apps/backend/src/routes/videoMoments.ts:113-160`) |
| Données audio | — | | | Micro coupé : `apps/mobile/app.json:92` (`"microphonePermission": false`) ; la vidéo reste sur l'iPhone (`apps/mobile/src/i18n/fr.ts:139`) |
| Contenu de jeu | — | | | — |
| Service client (*Customer Support*) | — | | | Pas de formulaire dans l'app : « Nous contacter » ouvre votre messagerie (`apps/mobile/src/lib/contact.ts:31-33`) ; les e-mails reçus sont hors de l'app |
| **Autre contenu de l'utilisateur** (*Other User Content*) | ✅ | Oui | Fonctionnalité de l'app | Légendes `posts.ts:478-483`, commentaires `apps/backend/src/routes/comments.ts:106-120`, bio `me.ts:172-185`, titres des pièces du Vault et des Envies `vault.ts:198`, `apps/backend/src/routes/wishlist.ts:111`, précisions d'un signalement `apps/backend/src/routes/reports.ts:41-49`, description d'une vidéo envoyée à Anthropic (avec accord) `videoMoments.ts:143-145` ; voie C allumée : les mots de « Que cherchez-vous ? », envoyés à SerpApi puis Google sans être enregistrés (`searches.ts:715-718`) |

### Historique de navigation (*Browsing History*)

| Type | Collecté | Preuve |
|---|---|---|
| Historique de navigation | — (conseillé) | Spotto enregistre le **clic** sur un lien de marchand (classé plus bas en « Interaction avec le produit »), pas les pages vues ensuite : elles s'ouvrent dans une fenêtre Safari dont l'app ne voit rien (`apps/mobile/src/lib/merchant-links.ts:90-93`). |

### Historique des recherches (*Search History*)

| Type | Collecté | Lié | Finalités | Preuve |
|---|---|---|---|---|
| **Historique des recherches** | ✅ | Oui | Fonctionnalité de l'app | Chaque recherche et ses résultats sont rangés sous le compte (`0001_init_schema.sql:44-55`), remontrés dans « Récemment spottées » (`searches.ts:876`), gardés 12 mois (`apps/backend/src/lib/searchRetention.ts:16`) |

### Identifiants (*Identifiers*)

| Type | Collecté | Lié | Finalités | Preuve |
|---|---|---|---|---|
| **Identifiant utilisateur** (*User ID*) | ✅ | Oui | Fonctionnalité de l'app ; Analyses | Identifiant du compte (Supabase) ; envoyé à Sentry avec les erreurs (`apps/mobile/src/lib/error-tracking.ts:45-47`, `apps/backend/src/lib/sentry.ts:64` et `:74`) et à PostHog avec les statistiques acceptées (`apps/mobile/src/lib/analytics.ts:69`) ; le nom d'utilisateur public est aussi un identifiant |
| **Identifiant de l'appareil** (*Device ID*) | ✅ (conseillé, par prudence) | Oui | Fonctionnalité de l'app | Aucun identifiant publicitaire (IDFA). Mais un plantage de l'app iPhone part à Sentry avec un identifiant d'installation pseudonyme, comme le dit la politique (`apps/mobile/src/legal/confidentialite.ts:51`) ; le nettoyage ne retire que `device_app_hash` (`apps/mobile/src/lib/sentry-scrub.ts:22-27`). Cocher n'ajoute rien de visible sur la fiche : la rubrique « Identifiants » y figure déjà. |

### Achats (*Purchases*)

| Type | Collecté | Lié | Finalités | Preuve |
|---|---|---|---|---|
| **Historique des achats** (*Purchase History*) | ✅ (conseillé, par prudence) | Oui | Fonctionnalité de l'app | Aucun achat dans l'app. Mais le Vault enregistre les pièces que la personne dit avoir achetées (« Je l'ai achetée », `apps/mobile/src/i18n/fr.ts:414` ; publications « achat », `0001_init_schema.sql:13`) : c'est une « tendance d'achat » au sens d'Apple. |

### Données d'utilisation (*Usage Data*)

| Type | Collecté | Lié | Finalités | Preuve |
|---|---|---|---|---|
| **Interaction avec le produit** (*Product Interaction*) | ✅ | Oui | Analyses | Avec accord seulement : événements d'usage envoyés à PostHog (`apps/mobile/src/lib/analytics-events.ts:28-100`, dont l'ouverture de l'app `:32` ; envoi `apps/mobile/src/lib/analytics.ts:82-92`, coupé sans accord `:56-58`). Même sans accord : chaque clic vers un marchand est enregistré sous le compte, avec l'identification du navigateur (*user agent*) (`apps/backend/src/routes/productMatches.ts:145`, table `0001_init_schema.sql:88-95`), pour mesurer les pièces qui intéressent (politique : `confidentialite.ts:62`) |
| Données publicitaires | — | | | Aucune publicité |
| Autres données d'utilisation | — | | | — |

### Diagnostics

| Type | Collecté | Lié | Finalités | Preuve |
|---|---|---|---|---|
| **Données de plantage** (*Crash Data*) | ✅ | Oui | Fonctionnalité de l'app | Sentry signale les plantages de l'app iPhone (`apps/mobile/src/lib/error-tracking.ts:9` et `:21-41`), avec l'identifiant du compte (`:45-47`) |
| Données de performances | — | | | Mesure de performance coupée : `error-tracking.ts:31-34` (`tracesSampleRate: 0`) et `apps/backend/src/lib/sentry.ts:52` |
| **Autres données de diagnostic** (*Other Diagnostic Data*) | ✅ | Oui | Fonctionnalité de l'app | Erreurs rattrapées par l'app (`error-tracking.ts:51-53`) et erreurs du serveur (`apps/backend/src/lib/sentry.ts:61-77`), avec l'identifiant du compte ; type de navigateur ou modèle de téléphone et version du système (politique `confidentialite.ts:51`) |

### Environnement, Corps

Rien à cocher (types réservés à l'Apple Vision Pro).

### Autres données (*Other Data*)

| Type | Collecté | Lié | Finalités | Preuve |
|---|---|---|---|---|
| **Autres types de données** | ✅ | Oui | Fonctionnalité de l'app | La déclaration « j'ai au moins 15 ans » et les accords datés (conditions, politique, statistiques, analyse des vidéos) : `packages/shared-types/src/index.ts:712` et `:783`, enregistrés par `apps/backend/src/routes/account.ts:113` |

---

## 3. Le résumé que verront les gens sur la fiche

Avec ces réponses, la fiche affichera :
- **Données utilisées pour vous suivre** : aucune.
- **Données liées à vous** : Achats, Coordonnées, Contacts, Contenu de l'utilisateur, Historique des recherches, Identifiants, Données d'utilisation, Diagnostics, Autres données.
- **Données non liées à vous** : aucune.

---

## 4. Qui reçoit quoi (pour vérifier les réponses)

| Prestataire | Ce qu'il reçoit | Preuve |
|---|---|---|
| **Supabase** (base, stockage des photos, comptes) | tout ce qui est rangé sous le compte | `apps/backend/src/env.ts:8-9`, `apps/backend/src/lib/storage.ts:9` |
| **Render** (serveur et site) | chaque requête, avec l'adresse IP, dans ses journaux ; jamais les mots tapés, un e-mail ni un identifiant de compte dans ces journaux | `apps/backend/src/lib/logPrivacy.ts:1-27` |
| **SerpApi, puis Google** (Lens, Google Shopping) | un lien temporaire vers l'image recadrée ; voie C allumée : la courte recherche écrite par l'IA et les mots de « Que cherchez-vous ? » ; jamais le compte | `apps/backend/src/routes/searches.ts:1028-1083` et `:1094-1194` |
| **Anthropic** (IA) | avec accord : 12 images réduites d'une vidéo et la description ; voie C allumée (avec son IA) : les titres et sites des 15 premiers résultats, jamais d'image | `apps/backend/src/routes/videoMoments.ts:147-160`, `apps/backend/src/services/shoppingQueryAi.ts:8`, `apps/backend/src/lib/aiSwitches.ts:65-68` |
| **Sentry** (erreurs) | rapports d'erreur et de plantage, avec l'identifiant du compte, sans nom, e-mail ni contenu | `apps/mobile/src/lib/sentry-scrub.ts:10-28`, `apps/backend/src/lib/sentry.ts:30-56` |
| **PostHog** (statistiques) | avec accord seulement : des événements d'une liste fermée, avec l'identifiant du compte, sans cookie | `apps/mobile/src/lib/analytics.ts:1-12`, `apps/mobile/src/lib/analytics-events.ts:1-6` |
| **TikTok, Meta** | rien aujourd'hui : un lien collé n'est pas envoyé au serveur | `apps/mobile/src/lib/spot-flags.ts:7`, `apps/mobile/src/lib/use-link-entry.ts:14` |
| **Sites des marchands et Google** (images affichées) | l'adresse IP de l'iPhone, quand l'app affiche leurs images ou ouvre leur page | politique `confidentialite.ts:98` |

---

## 5. Différences entre le code et la politique de confidentialité

La politique n'a **pas** été modifiée (ce n'est pas l'objet de ce lot). Voici ce que j'ai relevé, pour le dossier de l'avocat ou la prochaine version :

1. **Suppression après 3 ans sans connexion, avec un e-mail d'avertissement** (`apps/mobile/src/legal/confidentialite.ts:129`) : **rien n'est codé** (aucun « inactiv » dans `apps/backend/src`). Rien n'est dû avant 2029, mais la promesse est écrite.
2. **TikTok et Meta** (`confidentialite.ts:97`) : la politique dit que le serveur leur demande l'aperçu d'une vidéo quand on colle un lien. Aujourd'hui, ce n'est **jamais** le cas : l'analyse des liens est coupée (`apps/mobile/src/lib/spot-flags.ts:7`), et l'app n'envoie pas le lien au serveur (`apps/mobile/src/lib/use-link-entry.ts:14`). La politique en dit plus que le code : sans danger, mais inexact.
3. **Le Vault comme historique d'achats, les abonnements comme « contacts »** : la politique les décrit bien (`confidentialite.ts:44` et `:46`) ; c'est seulement Apple qui les range sous ces noms. Rien à changer.
4. **Expo (mises à jour à distance)** : une fois `eas update:configure` fait (`apps/mobile/BUILD-IPHONE.md`, section 1), chaque iPhone interrogera les serveurs d'Expo au lancement (adresse IP, version de l'app). Expo n'est pas dans la liste fermée des prestataires (`confidentialite.ts:89-96`). Aujourd'hui, `app.json` n'a pas encore d'adresse de mises à jour : rien ne part.
5. **Le service d'envoi des e-mails de connexion** (confirmation, mot de passe oublié), réglé dans Supabase : il reçoit les adresses e-mail et n'est pas cité (point 3 et point 7 de la feuille de route).
6. **« Hébergées en Irlande »** (`confidentialite.ts:90`) et durées de conservation de Render, Sentry et PostHog (`:130-131`, encore « [À vérifier] ») : impossible à vérifier depuis le code.
7. **« L'image analysée est supprimée dès le résultat »** (`confidentialite.ts:25` et `:123`) : vrai dans le cas normal ; après un plantage, une image restée est maintenant effacée au bout d'une heure, lors d'une recherche suivante (`apps/backend/src/routes/searches.ts:990-1000`, `apps/backend/src/lib/storage.ts:152`). « Quelques secondes » reste vrai dans le cas normal seulement.

Rien d'autre : les statistiques avec accord et sans cookie, les rapports d'erreur sans nom ni e-mail, les clics avec le *user agent*, l'historique de 12 mois, la vidéo qui reste sur l'iPhone et les 12 images réduites sont conformes au code.

---

## 6. Quand revoir ces réponses

Avant chaque build envoyé à Apple, si l'un de ces changements est entré dans `main` :
- le **lecteur intégré** TikTok / Instagram (branche `lot-lecteur`) : le lecteur officiel de ces plateformes peut déposer ses propres traceurs. Il faudrait alors revoir « Suivi » et « Historique de navigation » ;
- le **service anti-robots** (point 17) : il reçoit l'adresse IP et des données de l'appareil ;
- la **copie des photos** pour les sauvegardes (point 10) ;
- tout nouveau prestataire, toute nouvelle autorisation, tout nouvel événement de statistiques.
