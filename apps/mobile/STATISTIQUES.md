# Statistiques d'usage : mode d'emploi

Ce document explique, sans jargon, ce que Spotto mesure du parcours d'une
recherche, et comment le lire dans PostHog. Il sert à savoir **où les membres
abandonnent** et **combien de temps ils attendent** à chaque étape, pour
décider où rendre l'app plus fluide.

## En deux mots

- Les statistiques partent chez **PostHog, hébergé dans l'Union européenne**
  (Francfort). Même code pour l'app iPhone et pour le site.
- **Rien n'est mesuré sans l'accord « statistiques d'usage »** du membre
  (case facultative, décochée par défaut ; retrait possible à tout moment
  dans Réglages → Vos données). Les chiffres ne parlent donc que des membres
  qui ont accepté.
- Chaque événement porte seulement des **choix dans une liste fermée**, des
  **nombres** et des **oui/non**. Jamais un lien, un texte tapé, un nom ou
  une adresse de boutique, ni l'identifiant d'une recherche ou d'une pièce.
- Chaque événement porte aussi deux renseignements ajoutés par l'app :
  `environment` (`production` pour la vraie app, `development` pour les
  essais) et `platform` (l'appareil : `ios` pour l'app iPhone, `web` pour le
  site).

## ⚠️ À vérifier avant de lire les chiffres

- **La clé PostHog doit être réglée à la construction**, sinon rien n'est
  mesuré, sans aucun message d'erreur :
  - pour le **site** : la variable `EXPO_PUBLIC_POSTHOG_KEY` du service
    « site » chez Render (puis un déploiement **en vidant le cache**, sinon
    l'ancienne valeur peut rester) ;
  - pour l'**app iPhone** : la même variable dans les variables
    d'environnement d'EAS, pour « preview » et « production »
    (voir `apps/mobile/BUILD-IPHONE.md`).
- **Les menus de PostHog changent souvent.** Les chemins donnés ci-dessous
  (en anglais, comme l'écran de PostHog) peuvent avoir bougé ou changé de
  nom : cherchez le mot le plus proche.
- Filtrez toujours sur **`environment` = `production`**, pour ne pas mélanger
  les essais avec les vrais membres.

## Le parcours, étape par étape

Dans l'ordre où un membre les vit. Les noms en `police fixe` sont ceux que
vous verrez dans PostHog.

### 1. Ouvrir l'app

- **`app_opened`** : l'app est ouverte. `context` = `launch` (lancement) ou
  `resume` (retour dans l'app après 30 minutes au moins).
- **`server_first_response`** (nouveau) : une fois par ouverture comptée, le
  temps de la **première réponse du serveur**. `wait_ms` = l'attente en
  millisecondes, `context` = `launch` ou `resume`, `ok` = oui si le serveur a
  bien répondu, non en cas d'échec (réseau, erreur). Il montre combien de
  membres tombent sur le **serveur endormi** (offre gratuite de Render :
  jusqu'à environ une minute au réveil). Une requête annulée ne compte pas.

### 2. Commencer une recherche

- **`journey_started`** (nouveau) : le parcours commence, une fois, dès que
  l'app accepte ce que le membre lui donne (lien reconnu, fichier lisible),
  avant toute analyse. Une entrée refusée (lien invalide, vidéo trop longue)
  ne l'envoie pas : les événements de refus d'avant restent la mesure
  (`video_rejected`, aide « capture d'écran d'abord »).
  - `entry` = d'où vient le parcours :

    | Valeur | Ce que le membre a fait |
    | --- | --- |
    | `link_paste` | collé (ou tapé) un lien TikTok ou Instagram dans le Spotter |
    | `link_share` | partagé un lien depuis TikTok ou Instagram (feuille de partage de l'iPhone) |
    | `video_library` | choisi une vidéo dans sa photothèque (app iPhone) |
    | `video_file` | choisi un fichier vidéo (site) |
    | `video_latest` | lancé la dernière vidéo de sa galerie, proposée sur l'accueil (app iPhone) |
    | `video_share` | partagé une vidéo vers Spotto (feuille de partage) |
    | `photo_library` | choisi une photo ou une capture dans sa photothèque (app iPhone) |
    | `photo_file` | choisi une image (site) |
    | `photo_drop` | glissé-déposé ou collé une image sur la page (site) |
    | `photo_camera` | pris une photo avec l'appareil photo (app iPhone) |
    | `photo_share` | partagé une capture ou une photo vers Spotto (feuille de partage) |
    | `photo_visual_search` | envoyé une capture depuis la recherche d'image de l'iPhone |

    Astuce : toutes les valeurs commencent par `link`, `video` ou `photo`.
    Dans PostHog, le filtre « `entry` contient `link` » prend donc tous les
    liens d'un coup.
  - `link_platform` = `tiktok`, `instagram`, ou `none` quand il n'y a pas de
    lien (vidéo ou photo).
- **`spot_started`** : une recherche est préparée (gratuit). Inchangé.

### 3a. Depuis un lien TikTok ou Instagram

- **`player_opened`** : l'écran « vidéo partagée » s'ouvre. `link_platform`
  (nouveau) = `tiktok` ou `instagram`, comme dans tous les événements du
  lecteur (`player_…`) et de l'analyse d'un lien (`video_link_ai_…`).
- **`video_link_ai_started`** puis **`video_link_ai_result`** : l'IA cherche
  la pièce dans la vidéo. `outcome` = `found` (trouvée), `not_found`,
  `failed` ou `cancelled` (le membre a annulé). `reason` = la cause d'un
  échec. `wait_ms` (nouveau) = l'attente, du départ à l'issue (annulation
  comprise : le temps avant d'abandonner). `link_platform` (nouveau) =
  `tiktok` ou `instagram`.
- **Plan B** : quand la vidéo est privée, supprimée ou refusée par TikTok ou
  Instagram, l'app ne montre qu'un bouton, « Faire une capture d'écran ».
  - **Plan B montré** = `video_link_ai_result` avec `reason` = `private`
    (vidéo privée ou supprimée) ou `refused` (refusée par la plateforme).
    Pas d'événement à part : il ferait double emploi.
  - **`plan_b_screenshot_chosen`** (nouveau) : le membre a touché « Faire une
    capture d'écran ». `cause` = `private_or_removed` ou `refused` ;
    `link_platform` = `tiktok` ou `instagram`.
  - La capture ajoutée ensuite commence un **nouveau parcours**
    (`journey_started` avec une entrée `photo_…`).
- **`video_link_ai_moment_chosen`** : le membre a choisi un moment de la vidéo
  pour lancer la recherche.

### 3b. Depuis une vidéo du téléphone

- **`video_imported`** (ou **`video_rejected`** si elle est refusée).
- **`video_ai_frames_sent`** puis **`video_ai_result`** : l'IA cherche la
  pièce dans la vidéo. `wait_ms` (nouveau) = l'attente, du départ de
  l'analyse (images tirées sur le téléphone comprises) à son issue.
- **`video_ai_moment_tried`**, **`video_frame_chosen`** : un moment essayé,
  ou une image choisie à la main.

### 4. La recherche et ses résultats

- **`spot_launched`** : la recherche part (bouton « Lancer », ou lancement
  automatique).
- **`spot_completed`** : la réponse est là. `outcome` = `results` (des
  résultats), `none` ou `failed`. Nouveaux : `wait_ms` = l'attente, du
  lancement aux premiers résultats ; `shops_wait_ms` = l'attente, du
  lancement à la fin de la recherche « dans d'autres boutiques » (absente
  quand l'app n'a pas reçu cette fin).
- **`text_search_launched`** puis **`text_search_completed`** : « Que
  cherchez-vous ? ». `wait_ms` (nouveau) = l'attente jusqu'à l'issue.

### 5. La boutique

- **`merchant_link_opened`** : le membre ouvre une boutique. Nouveau sur
  l'écran Résultat : `mark` = la mention de l'offre —
  `official_shop` (« Boutique officielle de la marque »), `known_shop`
  (« Boutique connue »), `unusual_price` (« Prix inhabituellement bas ») ou
  `none` (aucune mention). Ailleurs (Envies, Vault, publications…), pas de
  `mark`. Pour savoir si les boutiques officielles sont davantage choisies :
  répartition de `merchant_link_opened` par `mark`, avec `context` = `result`
  ou `similar`.

### 6. Enregistrer

- **`wishlist_item_added`** : « Garder » sur l'écran Résultat (la pièce va
  dans les Envies).
- **`vault_item_added`** : une pièce entre dans le Vault. `source` =
  `spotter` pour « Je l'ai achetée » (sur l'écran Résultat ou sur une
  envie), `photo` pour une pièce ajoutée à la main dans le Vault. Rien quand
  la pièce y était déjà.

Ces deux gestes de l'écran Résultat étaient déjà comptés : rien n'a été
ajouté.

### Le guide de la première recherche

- **`first_search_guide`** (nouveau) : `action` = `shown` (le guide s'affiche,
  une seule fois par appareil), `skipped` (« Passer ») ou `finished` (la
  dernière étape, qui lance une vraie recherche). `step` = l'étape (1, 2 ou
  3) où le membre passe ou termine.

## Créer les deux entonnoirs dans PostHog

Un entonnoir montre, étape après étape, combien de membres continuent et où
ils s'arrêtent.

1. Dans PostHog : **Product analytics** → **New insight** → **Funnels**.
2. Ajoutez les étapes dans l'ordre (**Add step**), avec un filtre sur une
   étape par son petit entonnoir (**+ filter**).
3. Réglages :
   - **Aggregating by** : **Unique users** (par personne) ;
   - **Conversion window limit** : **1 hour** (une heure) ;
   - filtre de l'ensemble : `environment` = `production`.

**Entonnoir « depuis un lien de vidéo »**

1. `journey_started` avec `entry` contient `link`
2. `video_link_ai_result` avec `outcome` = `found`
3. `spot_completed` avec `outcome` = `results`
4. `merchant_link_opened`
5. `wishlist_item_added`

**Entonnoir « depuis une photo »**

1. `journey_started` avec `entry` contient `photo`
2. `spot_launched`
3. `spot_completed`
4. `merchant_link_opened`
5. `wishlist_item_added`

Pour comparer, utilisez **Breakdown** (répartition) : par `link_platform`
(TikTok ou Instagram) pour le premier, par `entry` pour le second, ou par
`platform` pour comparer l'app iPhone (`ios`) et le site (`web`). Le même
modèle marche pour les vidéos du téléphone (`entry` contient `video`, puis
`video_ai_result` avec `outcome` = `found`).

## Lire les temps d'attente

Les temps sont en **millisecondes**, arrondis à 100 ms : `12300` veut dire
**12,3 secondes**. Au-delà de 10 minutes, la valeur reste à `600000`.

1. **New insight** → **Trends**, événement `spot_completed` (ou
   `text_search_completed`, `video_link_ai_result`, `video_ai_result`).
2. À la place de **Total count**, choisissez **Property value** → `wait_ms`
   (ou `shops_wait_ms`), puis **Median** (médiane), puis ajoutez la même
   série avec **90th percentile** (90e centile).
3. Lecture :
   - la **médiane** : la moitié des membres attendent moins que ce temps ;
   - le **90e centile** : 9 membres sur 10 attendent moins ; le dixième,
     celui qui attend le plus, attend davantage. C'est souvent là que des
     membres abandonnent.

## Le serveur endormi : `server_first_response`

Au-dessus de **10 secondes**, le serveur dormait presque sûrement.

1. **New insight** → **Trends**.
2. Série A : `server_first_response`, **Total count**.
3. Série B : `server_first_response` avec le filtre `wait_ms` **greater
   than** `10000`.
4. **Formula** : `B / A * 100` = la part (en %) des ouvertures qui sont
   tombées sur le serveur endormi.

Répartition utile : par `context` (lancement ou retour dans l'app). La part
de `ok` = non montre les ouvertures où le serveur n'a pas répondu du tout.

## Les limites

- **Un parcours n'a pas d'identifiant à lui** : les entonnoirs se font par
  personne, dans une fenêtre d'une heure. Deux recherches dans la même heure
  se confondent ; un membre qui revient le lendemain recommence un
  entonnoir.
- **Rien n'est mesuré sans l'accord « statistiques »** : les chiffres ne
  comptent que les membres qui l'ont donné.
- **`platform` est toujours l'appareil** (`ios`, `web`), même dans les
  événements d'avant qui avaient une `platform` TikTok ou Instagram : PostHog
  ne reçoit que celle de l'appareil. Dans `player_opened`,
  `player_unavailable`, `player_fallback`, `player_consent`, `player_spot`,
  `video_link_ai_started` et `video_link_ai_moment_chosen`, l'ancienne
  propriété `platform` montre donc l'appareil : pour TikTok ou Instagram,
  utilisez `link_platform` (nouveau), comme dans `journey_started`,
  `video_link_ai_result` et `plan_b_screenshot_chosen`.
- **Les temps sont mesurés sur le téléphone ou l'ordinateur du membre** :
  ils comprennent son réseau (un mauvais réseau allonge l'attente).
- **`server_first_response`** suit les requêtes faites avec le compte du
  membre ; au lancement, la toute première est souvent la lecture de son
  accord aux statistiques. Une requête annulée ne compte pas : c'est la
  suivante qui compte. Une déconnexion ou un changement de compte efface la
  mesure qui attend : jamais la durée d'un compte sous un autre, ni celle
  d'un compte qui n'a pas donné son accord.
- **Les nouveaux chiffres ne commencent qu'avec la version** de l'app et du
  site qui les contient : rien avant.

## Ce qui ne part jamais

Ni lien, ni texte tapé (description, « Que cherchez-vous ? »), ni nom ou
adresse de boutique, ni identifiant de recherche ou de pièce, ni image, ni
nom de fichier, ni e-mail, ni nom d'utilisateur. Le catalogue fermé de l'app
(`apps/mobile/src/lib/analytics-events.ts`) retire tout le reste avant
l'envoi.
