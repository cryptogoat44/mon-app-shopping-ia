# Service vidéo séparé (apps/video-worker)

Petit service à part, hébergé chez Render, qui reçoit l'adresse d'une vidéo
publique TikTok ou Instagram, en lit le fichier sans le garder et renvoie
quelques images (6 à 16) au serveur principal. Le serveur principal donne
ensuite ces images à l'IA existante (analyse des moments), comme pour une
vidéo importée depuis le téléphone. Décision du fondateur des 14 et
15 novembre 2026.

Il ne parle qu'au serveur principal, sur le réseau privé de Render : il n'est
pas joignable depuis Internet, ni par l'app, ni par le site.

## Ce qu'il fait, étape par étape

1. Le serveur principal envoie `POST /frames` avec le secret partagé et
   l'adresse canonique de la vidéo (qu'il a lui-même reconstruite).
2. Le service vérifie le secret, puis l'adresse : https, hôte TikTok ou
   Instagram uniquement, forme d'une adresse de vidéo.
3. **yt-dlp** lit les informations publiques de la vidéo (durée, formats
   disponibles). Rien n'est téléchargé à cette étape.
4. Vidéo de plus de 90 s, direct ou publication sans vidéo : refus immédiat.
5. Le service choisit un fichier MP4 H.264 de 480 à 720 px (720p au plus).
6. **yt-dlp** télécharge ce fichier **en mémoire** (64 Mo au plus), jamais
   sur le disque ; pour un carrousel Instagram, seulement la vidéo choisie.
   Une erreur passagère de TikTok donne droit à un second essai. TikTok refuse le fichier à ffmpeg directement (« 403 »,
   constaté le 16 novembre 2026), mais le donne à yt-dlp.
7. **ffmpeg** lit le fichier en mémoire, que le service lui sert sur la
   boucle locale (127.0.0.1, adresse aléatoire, requêtes partielles : un MP4
   dont l'index est à la fin se lit aussi). Il en tire jusqu'à 40 images
   candidates, réparties sur toute la vidéo. Le fichier est effacé aussitôt.
8. Le service garde 6 à 16 images nettes, différentes les unes des autres et
   réparties dans le temps. Les mesures sont les mêmes que sur le téléphone :
   netteté, empreinte, couleurs.
9. Il renvoie ces images en JPEG (1 280 px au plus, qualité ≈ 82), puis efface
   tout ce qu'il avait en mémoire.

**Rien n'est écrit sur le disque** : ni la vidéo, ni les images, ni un cache.

- yt-dlp écrit le JSON puis le fichier sur sa sortie standard
  (`--dump-single-json`, puis `--output -`), avec `--no-cache-dir` et
  `--no-part`.
- ffmpeg écrit ses images dans deux tuyaux (`pipe:1` et `pipe:3`).
- Python ne crée pas de fichiers `.pyc`.

**Tout échec** renvoie un code d'erreur. Le serveur principal revient alors à
la capture d'écran, comme aujourd'hui.

## Contrat avec le serveur principal

Le client se trouve dans `apps/backend/src/lib/videoWorker.ts`, les
constantes dans `src/contract.js`.

- **Demander les images :**
  - `POST /frames`, en-tête `Authorization: Bearer <VIDEO_WORKER_SECRET>` ;
  - corps : `{"url": "https://www.tiktok.com/@pseudo/video/123…", "platform": "tiktok"}`
    (ou `"instagram"`) ;
  - réponse 200 : `{"durationSeconds": 30, "frames": [{"timeSeconds": 2.3, "width": 720, "height": 1280, "jpegBase64": "…"}]}`.
    Les images sont dans l'ordre du temps : 6 à 12, jusqu'à 16 pour une
    vidéo de plus de 40 s. Une vidéo de quelques secondes peut en donner
    moins.
- **Vérifier l'état du service :**
  - `GET /health`, sans secret ;
  - réponse : `{"status": "ok", "ytDlp": "2026.10.26", "ffmpeg": "7.1.x"}` ;
  - réponse 503 `{"status": "unavailable", …}` si le secret est absent ou
    invalide, si yt-dlp ou ffmpeg manquent, ou pendant un arrêt.
- **Limites :**
  - vidéo de 90 s au plus ;
  - 25 s au plus par demande, attente comprise ;
  - 2 demandes à la fois, plus une petite file de 2 (attente de 4 s au plus) ;
    au-delà, `busy`.

### Codes d'erreur

Réponse : `{"error": "<code>"}`. Le code fait foi ; le statut HTTP sert de
secours.

| Code | Statut | Quand |
|---|---|---|
| `bad_request` | 400 | Corps invalide, adresse refusée (autre site, http, paramètres…) |
| `unauthorized` | 401 | Secret absent ou faux ; ou service sans secret valide (tout est refusé) |
| `private` | 404 | Vidéo privée, compte privé, réservée aux abonnés ou aux adultes |
| `not_found` | 404 | Vidéo supprimée ou introuvable |
| `too_long` | 413 | Vidéo de plus de 90 s |
| `unsupported` | 422 | Adresse non reconnue par yt-dlp, publication sans vidéo, direct |
| `blocked` | 451 | Accès refusé au service : IP bloquée, connexion demandée, limite anonyme d'Instagram, restriction par pays, refus 403 |
| `unavailable` | 502 | Extracteur cassé par un changement de la plateforme, réponse illisible, ffmpeg en échec, adresse du fichier refusée |
| `busy` | 503 | Déjà 2 demandes en cours et file pleine, ou arrêt en cours |
| `timeout` | 504 | Plus de 25 s |

`private` et `not_found` partagent 404 ; le client accepte aussi 403 pour
`private`.

## Réglages (variables d'environnement)

| Variable | Obligatoire | Rôle |
|---|---|---|
| `VIDEO_WORKER_SECRET` | oui | Secret partagé avec le serveur principal : la même valeur des deux côtés. 32 à 512 caractères visibles, sans espace (ceux du début et de la fin sont retirés). Exemple : `openssl rand -hex 32`. |
| `PORT` | non | Port d'écoute, 10000 par défaut. |

Les espaces et retours à la ligne autour de la valeur sont retirés, comme
sur le serveur principal : une valeur collée telle quelle des deux côtés
vaut la même chose.

Sans secret valide, le service démarre quand même, pour que le journal dise
pourquoi. Il refuse alors toute demande (401) et `/health` répond 503.
**Le déploiement n'échoue pas pour autant** : Render l'affiche « Live »
(il ne lit pas le `HEALTHCHECK` de l'image, et ce mode d'emploi ne règle
aucun « Health Check Path »). Après chaque déploiement, vérifiez donc le
journal (aucune ligne `"event":"config"`, étape 6 ci-dessous) ou appelez
`/health` depuis le Shell du serveur principal (réponse 200 attendue,
étape 8).

Le secret ne figure jamais dans le dépôt, ni dans le journal. Il n'est jamais
transmis à yt-dlp ni à ffmpeg : leur environnement est réduit au strict
nécessaire.

## Créer le service chez Render (pas à pas)

Les noms des écrans et des boutons sont **à vérifier** : Render les change de
temps en temps.

1. Tableau de bord Render → **New +** → **Private Service** (à vérifier).
2. Choisissez le dépôt GitHub du projet, branche `main` (une fois le travail
   fusionné).
3. Réglages :
   - **Name** : par exemple `video-worker`. Choisissez un nom sans point.
     L'adresse interne vient de ce nom, mais Render peut y ajouter un
     suffixe : seule compte celle qu'il affiche (étape 7).
   - **Region** : **Frankfurt (EU Central)**, la même région que le serveur
     principal. C'est obligatoire pour le réseau privé.
   - **Runtime / Language** : **Docker** (à vérifier).
   - **Root Directory** : `apps/video-worker`.
   - **Dockerfile Path** : `./Dockerfile` (à vérifier : relatif au Root
     Directory).
   - **Instance Type** : **Starter** (512 Mo, 0,5 processeur).
4. **Environment** → ajoutez `VIDEO_WORKER_SECRET`, avec une valeur neuve tirée
   par `openssl rand -hex 32`. Inutile de régler `PORT`.
5. Créez le service. La première construction prend quelques minutes.
6. Vérifiez le journal :
   - une ligne `"event":"listening"` doit apparaître, avec les versions de
     yt-dlp et de ffmpeg ;
   - aucune ligne `"event":"config"` ni `"tool_missing"` ne doit apparaître.
7. Sur le **serveur principal** (onglet Environment), réglez :
   - `VIDEO_WORKER_URL` : copiez l'adresse interne que Render affiche pour le
     service vidéo (« Connect » → « Internal », ou « Internal Address », à
     vérifier), avec `http://` devant et le port `:10000` s'il n'y figure
     pas. Par exemple `http://video-worker:10000`, mais ne recopiez pas cet
     exemple sans vérifier : un nom faux rend chaque analyse « injoignable » ;
   - `VIDEO_WORKER_SECRET` : **la même valeur** qu'à l'étape 4 ;
   - `VIDEO_LINK_ANALYSIS_ENABLED=true`, quand vous voulez ouvrir la fonction.
8. Depuis le **Shell** du serveur principal, vérifiez :
   `curl <adresse de VIDEO_WORKER_URL>/health` doit répondre 200 et
   `"status":"ok"`. Une réponse 503 : secret absent ou invalide sur le
   service vidéo ; aucune réponse : adresse interne fausse.

**Aucun port public, aucun domaine.** Un « Private Service » n'est joignable
que par vos autres services de la même région. Ne créez pas de « Web
Service » : il serait exposé sur Internet.

### Coût attendu

- Offre **Starter** : environ **7 $ par mois** (grille de Render, **à
  vérifier**). Les services privés n'ont pas d'offre gratuite.
- Si les analyses sont trop lentes, l'offre **Standard** (2 Go, 1 processeur)
  coûte environ 25 $ par mois (**à vérifier**).
- Bande passante : environ 5 à 15 Mo lus par vidéo, négligeable.

## Mettre yt-dlp à jour (quand TikTok ou Instagram changent)

TikTok et Instagram modifient régulièrement leurs pages. yt-dlp est alors
corrigé, en général en quelques jours.

**Signe d'alerte** : beaucoup d'échecs `unavailable` (détail
`extractor_failed`) ou `blocked` dans le journal, alors que les liens
marchent dans un navigateur.

1. Repérez la dernière version de yt-dlp : https://pypi.org/project/yt-dlp/
   Prenez de préférence une version publiée depuis au moins quelques jours,
   sauf urgence (correctif de TikTok).
2. Dans `requirements.txt`, remplacez le numéro de version **et** l'empreinte
   SHA-256 du fichier `.whl`. L'empreinte figure sur la page PyPI de la
   version : « Download files », puis « view hashes ». Ou en une commande :

   ```sh
   curl -s https://pypi.org/pypi/yt-dlp/2026.10.26/json \
     | python3 -c "import json,sys; [print(f['filename'], f['digests']['sha256']) for f in json.load(sys.stdin)['urls']]"
   ```

3. Si la nouvelle version de yt-dlp change ses dépendances fixées
   (curl-cffi, cffi, pycparser, certifi), mettez-les à jour de la même façon.
   Elles sont listées dans les métadonnées de la version (`requires_dist`,
   lignes « extra == "pin-curl-cffi" »). Pour cffi, prenez le fichier
   `cp313-…-manylinux…x86_64.whl`.
4. Lancez les tests (ci-dessous), faites une demande de fusion, puis
   fusionnez. Render reconstruit et redéploie le service. Vous pouvez aussi
   utiliser « Manual Deploy » (à vérifier).
5. Vérifiez que la nouvelle version est en ligne : la ligne `"listening"` du
   journal affiche `ytDlp`. On peut aussi appeler `GET /health` depuis le
   Shell du serveur principal : `curl <adresse de VIDEO_WORKER_URL>/health`.

Mettez yt-dlp à jour au moins une fois par mois, même sans panne.

### Mettre à jour Node, ffmpeg ou l'image de base

- L'image de base est fixée dans `Dockerfile` (`NODE_IMAGE`), par sa version
  (`node:26.8.2-trixie-slim`) **et** son empreinte (`@sha256:…`). Changez les
  deux ensemble.
  - L'empreinte figure sur Docker Hub (page de l'image `node`, onglet
    « Tags »), ou s'obtient par
    `docker buildx imagetools inspect node:<version>-trixie-slim`.
  - Gardez Node 26, comme le reste du dépôt (`.node-version`).
- ffmpeg vient de Debian 13 (paquet `ffmpeg`, série 7.1). Sa version ne change
  qu'avec l'image de base, ou avec une mise à jour de sécurité de Debian lors
  d'une reconstruction.

## Lancer les tests

Les tests utilisent des faux yt-dlp et ffmpeg (`test/fakes/`). Ils n'appellent
jamais TikTok, Instagram ni aucun autre site : seulement la boucle locale de
la machine. Il faut Node 22 ou plus récent ; aucune dépendance à installer.

```sh
cd apps/video-worker
npm test
# ou : node --test --test-concurrency=1 "test/*.test.js"
```

Si ffmpeg est installé sur la machine, un test de plus le fait tourner sur une
vidéo de synthèse, fabriquée en mémoire. Sinon, ce test est ignoré.

## Journal

Une ligne JSON par demande, avec seulement des compteurs et des codes :

- `result` (`ok` ou le code d'erreur), `detail` (raison fixe, par exemple
  `ip_blocked`, `login_required`, `extractor_failed`, `too_long_metadata`,
  `queue_full`) ;
- `platform`, `ms`, `ytDlpMs` (informations), `downloadMs` et `mediaKb`
  (téléchargement), `ffmpegMs`, `attempts`, `mode` (`full` ou `keyframes`),
  `codec` ;
- `duration` (par tranche : `0-15`, `15-30`…), `candidates`, `frames` ;
- `active`, `queued`, `served`, `failed`.

Jamais l'adresse de la vidéo (ni son identifiant), jamais une image, jamais le
secret, jamais la sortie brute de yt-dlp ou de ffmpeg.

## Sécurité

- **Service privé** chez Render : il n'est pas joignable depuis Internet.
- **Secret partagé** :
  - comparé en temps constant ;
  - service fermé par défaut sans secret valide ;
  - jamais journalisé, jamais transmis aux programmes lancés.
- **Adresses (SSRF)** :
  - Adresse reçue : https uniquement, hôtes `tiktok.com`, `www.`, `m.`,
    `vm.`, `vt.tiktok.com`, `instagram.com` et `www.instagram.com`, forme
    d'une adresse de vidéo. Ni identifiants, ni port, ni paramètres.
  - Adresse du fichier vidéo, donnée par yt-dlp : https, nom de domaine public
    uniquement (jamais une IP, ni un nom interne du réseau privé), vérifiée
    au premier passage. **Limite connue** : le fichier vient d'un second
    passage de yt-dlp, dont l'adresse et les redirections ne sont pas
    revérifiées (les formats de secours sont limités à un MP4 en https).
    Aucun tiers ne choisit cette adresse : elle vient de TikTok ou de Meta.
  - ffmpeg ne parle jamais à Internet :
    - il lit seulement le fichier en mémoire, sur 127.0.0.1, à une adresse
      aléatoire servie le temps de l'extraction (`src/memserve.js`) ;
    - `-protocol_whitelist http,tcp` : ni fichier local, ni https, ni liste
      de lecture ;
    - démultiplexeur MP4 imposé.
- **Programmes lancés** :
  - toujours avec une liste d'arguments, jamais de shell, jamais `--exec` ;
  - l'adresse est passée après `--` ;
  - tués net (tout leur groupe de processus) au délai, à l'annulation ou si
    leur sortie dépasse le plafond ;
  - `tini` ramasse les processus orphelins.
- **Mémoire** :
  - corps de la demande limité à 4 Ko, JSON de yt-dlp à 8 Mo, fichier vidéo
    à 64 Mo (effacé dès l'extraction finie), images de ffmpeg à 48 Mo ;
  - une image rendue pèse 1 Mo au plus, l'ensemble 8 Mo au plus ;
  - les tampons sont effacés après la réponse.
- **Conteneur** :
  - utilisateur sans droits (`node`) ;
  - aucune écriture hors de `/tmp`, qui reste d'ailleurs inutilisé ;
  - versions fixées (image de base par empreinte, yt-dlp et ses dépendances
    par empreinte SHA-256).
- **Licences** :
  - yt-dlp est sous licence Unlicense ;
  - ffmpeg de Debian est sous GPL ; il tourne sur notre serveur et n'est
    jamais distribué (avis juridique à confirmer, voir les études).

## Points à vérifier après la mise en ligne

- **Taux de réussite depuis Render Francfort.** Les IP sortantes de Render
  sont partagées entre clients. Instagram sans compte risque d'échouer souvent
  (`blocked`). Faites un essai sur une vingtaine de liens de chaque plateforme.
- **Durée et mémoire sur l'offre Starter** (0,5 processeur), à mesurer :
  - le décodage complet est réservé aux vidéos de 45 s au plus
    (`fullDecodeMaxFrames` dans `src/contract.js`) ;
  - au-delà, seules les images clés sont lues. Si TikTok en met peu, une
    longue vidéo peut donner moins de 6 images.
- **Téléchargement par yt-dlp.** Depuis le 16 novembre 2026, c'est yt-dlp
  qui télécharge le fichier (ffmpeg se le voyait refuser par TikTok :
  `blocked` / `media_forbidden`). Si yt-dlp est refusé à son tour, le journal
  montrera encore `media_forbidden` : il faudra alors essayer l'option
  `--impersonate` de yt-dlp (imitation d'un navigateur), ou un relais.
- **Le Dockerfile n'a pas pu être construit sur la machine de développement**
  (pas de Docker) : la première construction chez Render fait foi.
- **Contrôle de santé** : Render ne propose peut-être pas de contrôle de santé
  pour un service privé (à vérifier). `GET /health` reste utile pour un essai
  à la main, et l'image déclare un `HEALTHCHECK` Docker.
