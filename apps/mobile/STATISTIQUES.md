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
    **mon-app-shopping-ia-web** chez Render (le site, pas spotto-api), puis
    un déploiement **en vidant le cache**, sinon l'ancienne valeur peut
    rester ;
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
  bien répondu, non en cas d'échec (réseau, erreur) ou quand **l'app a cessé
  d'attendre** (par exemple au bout de 15 secondes pour le profil, ou de 10
  secondes pour relire une recherche au retour dans l'app) : `wait_ms` est
  alors la durée de cette attente, et le membre a attendu plus longtemps.
  Il montre combien de membres tombent sur le **serveur endormi** (offre
  gratuite de Render : jusqu'à environ une minute au réveil). Une requête
  annulée par le membre (« Annuler », écran quitté) ne compte pas.

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
- **`mode`** (nouveau, lot « propositions ») sur `video_link_ai_started`,
  `video_link_ai_result` et `video_link_ai_moment_chosen` : `words` quand le
  membre a écrit ce qu'il cherche, `pieces` quand il a touché « Voir les
  propositions de l'IA ». En mode `pieces`, `moments_count` compte les pièces
  proposées (une image chacune) et `rank` désigne la pièce lancée (1 = la
  première, déjà choisie). Une valeur absente vient des versions d'avant :
  elle veut dire `words`. Détail plus bas, « Les propositions de l'IA ».

### 3b. Depuis une vidéo du téléphone

- **`video_imported`** (ou **`video_rejected`** si elle est refusée).
- **`video_ai_frames_sent`** puis **`video_ai_result`** : l'IA cherche la
  pièce dans la vidéo. `wait_ms` (nouveau) = l'attente, du départ de
  l'analyse (images tirées sur le téléphone comprises) à son issue.
- **`video_ai_moment_tried`**, **`video_frame_chosen`** : un moment essayé,
  ou une image choisie à la main.

### 4. La recherche et ses résultats

- **`spot_started`** : la recherche est préparée (gratuit), au moment de
  « Lancer », juste avant `spot_launched`. Inchangé.
- **`spot_launched`** : la recherche part (bouton « Lancer », ou lancement
  automatique).
- **`spot_completed`** : envoyé quand la recherche « dans d'autres
  boutiques » est finie, jusqu'à 40 secondes après l'affichage des résultats
  (tout de suite quand elle arrive avec eux ou n'a pas lieu). Les résultats,
  eux, sont déjà à l'écran et cliquables : le membre a souvent ouvert une
  boutique ou gardé une pièce avant. Une recherche retrouvée après une
  réponse perdue (réseau coupé, retour sur TikTok) ne l'envoie pas. Il part
  seulement sous le compte qui a lancé la recherche, s'il avait donné son
  accord à ce moment-là : jamais sous un autre compte connecté entre-temps.
  `outcome` = `results` (des résultats), `none` ou `failed`. Nouveaux :
  `wait_ms` = l'attente, du lancement aux premiers résultats (même si
  l'événement part plus tard) ; `shops_wait_ms` = l'attente, du lancement à
  la fin de la recherche « dans d'autres boutiques » (absente quand l'app n'a
  pas reçu cette fin ; égale à `wait_ms` quand cette recherche n'a pas eu
  lieu : aucun résultat, ou IA coupée, `complement` = `skipped`).
- **`text_search_launched`** puis **`text_search_completed`** : « Que
  cherchez-vous ? ». `outcome` = `shown` (des résultats), `empty` (aucun),
  `shopping_failed` (la recherche en ligne a échoué) ou `failed` (panne du
  réseau ou du serveur, souvent immédiate sans réseau). `wait_ms` (nouveau)
  = l'attente jusqu'à l'issue.
- **`result_view_changed`** : le tri ou un filtre de l'écran Résultat a
  changé. `sort` = le tri choisi, `with_price_only` = « Avec prix seulement »
  allumé ou non, `change` = ce qui a changé : `sort` (le tri), `filter`
  (« Avec prix seulement », inchangé) ou, nouveau, `stock_filter` (« En stock
  seulement »). Nouveau aussi : `in_stock_only` = « En stock seulement »
  allumé ou non (absent dans les versions d'avant). Ce filtre n'est proposé
  que si une offre de l'écran dit son stock : il est donc rare au début.
- **`verdict_shown`** (nouveau) : la phrase de tête de l'écran Résultat
  (le verdict) est montrée. `level` = `identified` (« Pièce identifiée,
  d'après les titres des boutiques »), `close` (« Pièce probablement
  trouvée ») ou `lookalikes` (« Pas de pièce exacte trouvée »). Une fois par
  résultat affiché, et de nouveau si le niveau change quand les boutiques
  arrivent quelques secondes plus tard. Absent quand le serveur ne sait pas
  (migration 0055 pas encore appliquée, boutiques en échec) : il sera donc
  rare tant que 0055 n'est pas en production. Jamais la pièce, la marque,
  une boutique, un prix ni le nombre de boutiques.
  **Comment le lire.** Clics vers une boutique selon le niveau : dans
  PostHog, un entonnoir `verdict_shown` → `merchant_link_opened` (avec
  `context` = `result`), découpé par `level` (« Breakdown » sur `level` de la
  première étape) : la part des personnes qui ouvrent une boutique après
  chaque niveau. On attend plus de clics après `identified` qu'après
  `lookalikes`. Signalements « Ce n'est pas la bonne pièce » : ils ne
  passent pas par PostHog (ils sont dans la base, table `match_feedback`,
  raison `wrong_item`). Pour les lire selon le niveau, comptez-les sur les
  offres des boutiques dont le titre nommait la marque et le modèle
  (`product_matches.title_tier` = 0) et sur les autres : beaucoup de
  signalements sur les premières voudraient dire que « Pièce identifiée »
  se trompe, et qu'il faut durcir la règle avant tout le reste.

### 5. La boutique

- **`merchant_link_opened`** : le membre ouvre une boutique. Nouveau sur
  l'écran Résultat : `mark` = la mention de l'offre —
  `official_shop` (« Boutique officielle de la marque »), `known_shop`
  (« Boutique connue »), `unusual_price` (« Prix inhabituellement bas ») ou
  `none` (aucune mention). Pas de `mark` ailleurs (Envies, Vault,
  publications…), ni sur les cartes « Pièces déjà repérées » de l'écran
  « vidéo partagée », ni depuis les versions de l'app d'avant ce lot. Pour
  savoir si les boutiques officielles sont davantage choisies : répartition
  de `merchant_link_opened` par `mark`, avec `context` = `result` ou
  `similar` **et le filtre `mark` is set** (« est renseignée »). Sans ce
  filtre, une case vide (« None » ou « (empty) ») s'ajoute à côté de `none` :
  ce sont les clics sans mention connue, à ne pas compter avec « aucune
  mention ».

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
3. `spot_launched`
4. `merchant_link_opened`
5. `wishlist_item_added`

L'étape 2 ne compte que le chemin de l'**analyse par l'IA**, et seulement
quand cette analyse est allumée sur le serveur (réglage
`VIDEO_LINK_ANALYSIS_ENABLED` chez Render, coupé par défaut : coupée,
personne ne passe l'étape 2). Les membres qui continuent autrement
s'arrêtent à l'étape 1 dans cet entonnoir : « Spotter ce moment » dans le
lecteur officiel (`player_spot`, app iPhone) ou une capture d'écran. Pour
les voir, faites aussi l'entonnoir **sans l'IA** :

1. `journey_started` avec `entry` contient `link`
2. `spot_launched`
3. `merchant_link_opened`
4. `wishlist_item_added`

Et lisez la réussite de l'IA à part : **Trends** sur `video_link_ai_result`,
**Breakdown** par `outcome`. Une boutique ouverte depuis « Pièces déjà
repérées », sous la vidéo, saute la recherche (pas de `spot_launched`) : elle
n'avance dans aucun de ces entonnoirs.

**Entonnoir « depuis une photo »**

1. `journey_started` avec `entry` contient `photo`
2. `spot_launched`
3. `merchant_link_opened`
4. `wishlist_item_added`

**Pourquoi `spot_completed` n'est dans aucun entonnoir** : il part quand la
recherche « dans d'autres boutiques » est finie, souvent après le clic vers
une boutique ou « Garder », car les résultats sont déjà à l'écran. Un
entonnoir compte les étapes dans l'ordre : il compterait ces membres, les
plus rapides, comme arrêtés. Lisez « avec résultats » à part : **Trends** sur
`spot_completed`, **Breakdown** par `outcome`.

Pour comparer, utilisez **Breakdown** (répartition) : par `link_platform`
(TikTok ou Instagram) pour le premier, par `entry` pour le second, ou par
`platform` pour comparer l'app iPhone (`ios`) et le site (`web`). Le même
modèle marche pour les vidéos du téléphone (`entry` contient `video`, puis
`video_ai_result` avec `outcome` = `found`), avec la même limite : une image
choisie à la main (`video_frame_chosen`) ne passe pas par
`video_ai_result` ; faites aussi l'entonnoir sans cette étape.

## Les propositions de l'IA (lien vidéo) : `mode`

Lot « propositions » : sur l'écran d'un lien TikTok ou Instagram, le membre
peut toucher « Voir les propositions de l'IA » au lieu d'écrire. Visible
seulement si le réglage `VIDEO_PIECES_ENABLED` est allumé chez Render (coupé
par défaut) **et** l'analyse des liens aussi. Les trois événements de
l'analyse d'un lien disent alors `mode` = `pieces`.

- **L'entonnoir « depuis un lien de vidéo »** (plus haut) reste valable dans
  les deux modes : son étape 2 compte aussi les propositions reçues.
- **Comparer les deux modes** : **Breakdown** par `mode` sur
  `video_link_ai_result` (avec `outcome` = `found`), ou sur
  `video_link_ai_moment_chosen`.
- **« Aucune pièce proposée »** : `video_link_ai_result` avec `mode` =
  `pieces` et `outcome` = `not_found`. Pas d'événement à part.
- **Quelle pièce est lancée** : `rank` de `video_link_ai_moment_chosen` avec
  `mode` = `pieces` (1 = la première, déjà choisie à l'écran).

**Entonnoir « essais manqués »** : la pièce cherchée n'était pas dans les
propositions, et le membre l'a décrite ensuite (une seconde analyse par
l'IA). Mêmes réglages que les entonnoirs plus haut (**Unique users**,
**1 hour**, `environment` = `production`) :

1. `video_link_ai_result` avec `mode` = `pieces` et `outcome` = `found`
2. `video_link_ai_started` avec `mode` = `words`

La part qui passe l'étape 2 = la part des essais manqués. Chacun coûte une
analyse de plus (deux sur les 10 du jour du membre). Un membre qui revient au
champ sans rien relancer s'arrête à l'étape 1.

Jamais un nom proposé ni le texte du champ : seulement `words` ou `pieces`.

## Lire les temps d'attente

Les temps sont en **millisecondes**, arrondis à 100 ms : `12300` veut dire
**12,3 secondes**. Au-delà de 10 minutes, la valeur reste à `600000`.

1. **New insight** → **Trends**, événement `spot_completed` (ou
   `text_search_completed`, `video_link_ai_result`, `video_ai_result`).
2. Filtrez sur l'issue, pour ne pas mélanger les vraies attentes avec les
   annulations, les échecs rapides (vidéo privée…) et les recherches sans
   résultat :
   - `spot_completed` : `outcome` = `results` ; pour `shops_wait_ms`, en
     plus `complement` **is not** `skipped` (IA coupée : aucune recherche
     dans d'autres boutiques, la valeur vaut alors `wait_ms`) ;
   - `text_search_completed` : `outcome` = `shown` ;
   - `video_link_ai_result` et `video_ai_result` : `outcome` = `found`.
3. À la place de **Total count**, choisissez **Property value** → `wait_ms`
   (ou `shops_wait_ms`), puis **Median** (médiane), puis ajoutez la même
   série avec **90th percentile** (90e centile).
4. Lecture :
   - la **médiane** : la moitié des membres attendent moins que ce temps ;
   - le **90e centile** : 9 membres sur 10 attendent moins ; le dixième,
     celui qui attend le plus, attend davantage. C'est souvent là que des
     membres abandonnent.

## Le serveur endormi : `server_first_response`

À partir de **9 secondes**, le serveur dormait presque sûrement.

1. **New insight** → **Trends**.
2. Série A : `server_first_response`, **Total count**.
3. Série B : `server_first_response` avec le filtre `wait_ms` **greater
   than** `8900` (c'est-à-dire 9 secondes ou plus, puisque les temps sont
   arrondis à 100 ms : ainsi une relecture abandonnée au bout de 10 secondes
   entre aussi, même mesurée un peu sous `10000`, sauf si l'app a d'abord dû
   renouveler la connexion du membre pendant plus d'environ 1 seconde : voir
   plus bas).
4. **Formula** : `B / A * 100` = la part (en %) des ouvertures qui sont
   tombées sur le serveur endormi.

Répartition utile : par `context` (lancement ou retour dans l'app). La part
de `ok` = non montre les ouvertures où le serveur n'a pas répondu à temps :
erreur, panne du réseau, ou l'app qui a cessé d'attendre (15 secondes pour
le profil ; 10 secondes pour relire une recherche au retour dans l'app, avec
`wait_ms` autour de `10000`, ou nettement moins quand l'app a d'abord
renouvelé la connexion du membre, car seul le temps après ce renouvellement
est mesuré : ces ouvertures peuvent alors manquer à la série B et
n'apparaître que dans la part de `ok` = non ; souvent le serveur endormi).
Pour celles-là, `wait_ms` est la durée de l'attente de l'app : le membre a
attendu plus longtemps.

## Après la boutique : « Vous l'avez achetée ? » et l'alerte de prix

Nouveau (Parcours 3), avec le même accord « statistiques d'usage ». Sur le
site, comme le reste, rien n'est mesuré sans `EXPO_PUBLIC_POSTHOG_KEY` au
moment de la construction (voir « À vérifier avant de lire les chiffres »).

### Les événements

- **`shop_returned`** : le membre revient de la boutique, depuis l'écran
  Résultat ou la fiche d'une Envie. Envoyé à **chaque retour repéré**, que la
  question soit posée ou non, même après moins de 30 secondes.
  - `context` = `result` (grande carte, ou carte de la recherche visuelle),
    `similar` (« Cette pièce dans d'autres boutiques », résultats pour vos
    mots), `wishlist` (fiche d'une Envie) ou `price_alert` (fiche ouverte
    par une alerte).
  - `away_ms` = le temps passé dans la boutique, du clic au retour, en
    millisecondes (arrondi à 100 ms ; `600000` au-delà de 10 minutes).
  - Repéré sur l'app iPhone quand le membre ferme la fenêtre de la boutique ;
    sur le site, quand il revient sur l'onglet de Spotto après que la
    boutique s'est ouverte dans un autre onglet. Une boutique ouverte dans une
    fenêtre à part, une ouverture bloquée par le navigateur, la grille des
    Envies, le Vault, les publications et les messages ne l'envoient pas.
- **`purchase_question`** : la question « Vous l'avez achetée ? ».
  `action` = `shown` (montrée, une fois), puis une seule réponse : `yes`
  (« Oui, je l'ai achetée »), `no` (« Non, pas encore ») ou `later`
  (« Plus tard », le fond ou le geste de retour). `context` : comme
  `shop_returned`. La question n'est posée qu'après au moins 30 secondes
  dans la boutique, une fois par pièce et par jour, 2 fois par jour au plus,
  et jamais pour une pièce déjà dans le Vault.
- **`price_watch_changed`** : l'alerte de baisse de prix d'une pièce.
  `origin` = `save` (allumée par « Garder »), `undo` (« Couper l'alerte »)
  ou `question` (allumée depuis la question : « Garder » ou « Activer
  l'alerte »). Une cloche réglée à la main ne l'envoie pas.
- **`price_drop_shown`** : la grille des Envies montre au moins une
  « Baisse de prix ». Une fois au plus tant que l'app reste ouverte ;
  `count` = combien.
- Inchangés : « Oui » envoie le même `vault_item_added` (`source` =
  `spotter`) que « Je l'ai achetée » (rien quand la pièce y était déjà) ;
  « Garder » depuis la question envoie le même `wishlist_item_added`
  (`context` = `result`) ; « Partager… » ouvre seulement la fiche de la
  pièce : `post_published` (`type` = `purchase`) ne part qu'avec « Partager
  dans mon fil ».

### Entonnoir « Retour de boutique »

Mêmes réglages que les entonnoirs plus haut (**Unique users**, **1 hour**,
`environment` = `production`) :

1. `merchant_link_opened`
2. `shop_returned`
3. `purchase_question` avec `action` = `shown`
4. `purchase_question` avec `action` = `yes`
5. `vault_item_added`
6. `post_published` avec `type` = `purchase`

À savoir pour le lire :
- entre les étapes 2 et 3, la chute est normale : retours de moins de
  30 secondes, pièce déjà demandée aujourd'hui, 2 questions déjà posées, pièce
  déjà dans le Vault ;
- l'étape 1 compte aussi les clics d'où rien n'est guetté (grille des Envies,
  Vault, publications…). Pour ne garder que l'écran Résultat, filtrez
  l'étape 1 sur `context` = `result` ou `similar` (la grille des Envies a,
  elle aussi, `context` = `wishlist`) ;
- l'étape 6 peut venir plus tard que l'heure de l'entonnoir : un membre
  publie souvent son achat après l'avoir reçu.

### Entonnoir « Alerte »

1. `wishlist_item_added`
2. `price_watch_changed` avec `origin` = `save`

Une pièce qui ne peut pas être suivie (boutique ou produit non reconnus,
prix dans une autre devise) s'arrête à l'étape 1 : c'est attendu. **Part des
alertes coupées** : **Trends** sur `price_watch_changed`, **Breakdown** par
`origin` ; la part de `undo` sur `save` + `question` dit combien de membres
ne veulent pas de l'alerte allumée d'office.

Puis, pour savoir si la baisse fait revenir à la boutique :

1. `price_drop_shown`
2. `merchant_link_opened` avec `context` = `wishlist`

`price_drop_shown` ne part qu'une fois par ouverture de l'app : l'entonnoir
compte des personnes, pas chaque baisse.

### Lire `away_ms` (pour régler les 30 secondes)

1. **New insight** → **Trends**, événement `shop_returned`.
2. À la place de **Total count** : **Property value** → `away_ms` →
   **Median**, puis la même série avec **90th percentile**.
3. **Part des retours sous 30 secondes** : série A, `shop_returned`, **Total
   count** ; série B, `shop_returned` avec le filtre `away_ms` **less than**
   `30000` ; **Formula** : `B / A * 100`.

Si la plupart des retours durent moins de 30 secondes, la question est
rarement posée ; si la médiane est bien au-dessus, les 30 secondes laissent
passer la plupart des vraies visites. Changer ce seuil est un changement de
code (`MIN_AWAY_MS`, `apps/mobile/src/lib/purchase-question.ts`).

## Les nouveautés des Envies (lot « alertes visibles »)

Le bandeau « 2 nouveautés » en tête des Envies (onglet Envies du Profil)
montre les baisses de prix et les retours en stock des 30 derniers jours,
encore vrais.

- **`news_banner_shown`** : le bandeau affiche des nouveautés pas encore vues
  sur cet appareil ; `count` = combien. Une fois par nouveauté : affichée,
  elle est notée « vue » sur l'appareil.
- **`news_line_opened`** : une ligne du bandeau touchée (l'Envie s'ouvre) ;
  `kind` = `price_drop` (baisse de prix) ou `restock` (retour en stock).
  Ni la pièce, ni la boutique, ni le prix, ni le jour.
- Ouverte depuis le bandeau, la fiche de l'Envie compte le clic vers la
  boutique avec `context` = `wishlist`, comme une fiche ouverte depuis la
  liste (jamais `price_alert`, réservé à une fiche ouverte par une
  notification) : la confidentialité promet que, pour les nouveautés, les
  statistiques comptent seulement leur nombre et la sorte ouverte.

**Part des membres qui ouvrent une nouveauté** : entonnoir (**Unique
users**, **1 day**) `news_banner_shown` → `news_line_opened`. Le clic vers
la boutique qui suit ne se distingue pas d'un clic depuis la liste des
Envies.

## La page look (lot « page look »)

« Partager le look » crée un lien vers une page visible sans compte.
Décision du fondateur (23 novembre 2026) : **rien n'est compté chez le
visiteur** — ni vue, ni clic, ni inscription commencée, et rien n'est déposé
sur son appareil. Le serveur ne compte pas non plus les lectures d'une page.
Seuls les membres qui ont accepté les statistiques envoient :

- **`look_shared`** : un lien partagé depuis la grande carte ; `method` =
  `native` (feuille de partage du téléphone ou du navigateur) ou `copy`
  (lien copié, navigateur sans partage) ; `reused` = oui quand la page
  existait déjà pour cette pièce (même lien). Fermer la feuille de partage
  sur iPhone sans choisir d'app n'est pas compté.
- **`look_stopped`** : une page arrêtée depuis Réglages → Vos données →
  « Pages look partagées » (`from` = `settings`). Une page arrêtée par la
  modération ou expirée n'est pas comptée.
- **`look_signup`** : envoyé juste après `signup_completed` quand
  l'inscription est partie de « Trouver la mienne » **dans la même session
  de l'onglet** (drapeau gardé en mémoire seulement, jamais sur l'appareil ni
  dans l'adresse). Il **sous-compte** : lien de confirmation de l'e-mail
  ouvert dans un autre onglet ou sur un autre appareil, onglet fermé entre
  les deux, ou inscrit qui refuse les statistiques — tous ceux-là ne sont pas
  comptés.

Jamais la pièce, la boutique, le prix, le lien ni un identifiant.

**Lire « pages créées → inscriptions venues d'une page »** : dans PostHog,
un graphique **Trends** avec deux séries, `look_shared` (filtre `reused` =
false, pour ne compter qu'une fois chaque page) et `look_signup`, par
semaine. Le rapport des deux donne un ordre de grandeur (au plus bas, voir
ci-dessus), pas une conversion exacte : un `look_signup` n'est relié à
aucune page en particulier. **Les vues ne sont pas comptées** : on ne sait
pas combien de personnes ouvrent un lien (décision n° 3, rien n'est
enregistré sur des inconnus).

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
  accord aux statistiques. Une requête annulée par le membre ne compte pas :
  c'est la suivante qui compte. Une requête que l'app cesse d'attendre
  compte, avec `ok` = non. Une déconnexion ou un changement de compte efface la
  mesure qui attend : jamais la durée d'un compte sous un autre, ni celle
  d'un compte qui n'a pas donné son accord.
- **Les nouveaux chiffres ne commencent qu'avec la version** de l'app et du
  site qui les contient : rien avant.

## Ce qui ne part jamais

Ni lien, ni texte tapé (description, « Que cherchez-vous ? »), ni nom d'une
pièce proposée par l'IA, ni nom ou
adresse de boutique, ni identifiant de recherche ou de pièce, ni image, ni
nom de fichier, ni e-mail, ni nom d'utilisateur. Le catalogue fermé de l'app
(`apps/mobile/src/lib/analytics-events.ts`) retire tout le reste avant
l'envoi.
