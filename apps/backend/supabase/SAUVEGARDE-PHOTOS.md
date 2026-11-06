# La copie hebdomadaire des photos

*Point 10 de la feuille de route V1 (les sauvegardes). État au 6 novembre 2026.*

Les sauvegardes de Supabase gardent la base, mais **aucune photo**. Les photos du Vault, des publications et les photos de profil sont dans le stockage de Supabase (buckets `vault-media`, `post-media` et `avatars`). Si elles sont effacées par erreur, rien ne les ramène.

Le script `sauvegarder-photos` en garde une copie dans un autre stockage, privé, une fois par semaine.

> ⓘ **À retenir**
> - La copie est un **miroir**. Une photo effacée de Spotto (compte supprimé, publication retirée) disparaît de la copie au passage suivant, soit **7 jours au plus**.
> - **Garde-fou** : si un passage devait effacer beaucoup de photos d'un coup (Supabase vidé par erreur), il n'efface rien et finit en échec. Vous êtes prévenu, et la copie reste intacte.
> - Le script ne fait que des **copies**. Il ne modifie jamais les photos de Spotto, sauf en restauration : il remet alors les photos qui manquent, sans jamais en remplacer une.
> - Les images envoyées à la recherche (bucket `screenshots`) ne sont pas copiées : elles sont effacées dans l'heure.

## Comment ça marche

Une **tâche planifiée** (un « cron job » chez Render) lance le script chaque dimanche à 3 h 17 (heure de Londres). Le script :

1. lit la liste des photos des 3 buckets dans Supabase ;
2. lit la liste des photos déjà dans la copie ;
3. copie les nouvelles photos, et celles qui ont changé (une photo de profil remplacée) ;
4. efface de la copie les photos qui ne sont plus dans Supabase, sauf si le garde-fou bloque.

Le journal ne contient que des nombres, par exemple : `vault-media : 1 240 photos dans Supabase, 35 copiées, 1 205 déjà à jour, 3 effacées.`. Jamais un nom de fichier, ni un identifiant de compte.

## 1. Choisir le stockage de la copie

Le script parle à tout stockage « compatible S3 », la norme d'Amazon que la plupart des services de stockage comprennent.

**Recommandé : Cloudflare R2.** Vous aurez déjà un compte Cloudflare pour l'anti-robots (apps/mobile/ANTI-ROBOTS.md). Ses prix, relevés le 6 novembre 2026 sur <https://developers.cloudflare.com/r2/pricing/> :

- **gratuit** jusqu'à 10 Go stockés par mois, 1 million d'écritures et 10 millions de lectures par mois ;
- au-delà, 0,015 $ par Go et par mois ;
- les téléchargements sont gratuits, une restauration ne coûte donc rien de plus.

Une photo de Spotto pèse quelques centaines de Ko : 10 Go représentent des dizaines de milliers de photos.

Autres choix possibles, sans changer le code : Backblaze B2, AWS S3, Scaleway, OVHcloud.

💶 **Ce qui devient payant** : R2 au-delà de 10 Go (quelques centimes par mois au début), et la tâche planifiée de Render : facturée à la seconde, avec un **minimum de 1 $ par mois** et par tâche (relevé sur <https://render.com/docs/cronjobs> ; à vérifier sur la page des prix de Render).

## 2. Créer la copie chez Cloudflare R2

Les noms de menus viennent de la documentation de Cloudflare. L'interface change souvent : en cas de doute, cette documentation fait foi.

1. Tableau de bord Cloudflare → **R2 Object Storage** → **Create bucket**.
2. Nom : `spotto-copie-photos`.
3. **Emplacement** : choisissez la **juridiction EU** (« Specify jurisdiction » → **European Union (EU)**, à vérifier). Elle garde les photos dans l'Union européenne. Elle ne se choisit **qu'à la création** du bucket.
4. Laissez l'**accès public coupé**. C'est le réglage par défaut (à vérifier) : la copie ne doit jamais être lisible depuis Internet.
5. Créez une clé d'accès réservée à ce bucket : R2 → **Manage API tokens** → **Create API token** (à vérifier).
   - Permission : **Object Read & Write**.
   - Portée : **ce bucket seulement** (« Apply to specific buckets only »).
6. Cloudflare affiche alors l'**Access Key ID** et la **Secret Access Key**. ⚠️ La clé secrète n'est montrée qu'une fois (à vérifier) : collez-la directement dans Render (section 3), jamais dans un fichier du dépôt ni dans la conversation.
7. Notez l'**adresse S3** de votre compte. Avec la juridiction EU, elle a la forme `https://<identifiant-du-compte>.eu.r2.cloudflarestorage.com`.

## 3. Créer la tâche planifiée chez Render

Labels à vérifier dans Render.

1. <https://dashboard.render.com> → **New** → **Cron Job**, depuis le dépôt GitHub `mon-app-shopping-ia`, branche `main`.
2. **Name** : `spotto-copie-photos`. **Region** : la même que spotto-api.
3. **Schedule** : `17 3 * * 0`, soit chaque dimanche à 3 h 17. Render compte en heure de Londres (UTC), à vérifier.
4. **Build Command** : la même que celle de spotto-api, à recopier depuis spotto-api → **Settings**. Elle installe aussi les outils dont le script a besoin.
5. **Command** : `pnpm --filter backend sauvegarder-photos --essai` pour le premier passage. On retire `--essai` à l'étape 8.
6. **Instance type** : la plus petite.
7. Onglet **Environment**, ajoutez ces 7 variables :

   | Variable | Valeur |
   |---|---|
   | `SUPABASE_URL` | la même que dans spotto-api |
   | `SUPABASE_SERVICE_ROLE_KEY` | la même que dans spotto-api ⚠️ clé secrète |
   | `PHOTO_BACKUP_S3_ENDPOINT` | l'adresse S3 de l'étape 2.7 |
   | `PHOTO_BACKUP_S3_REGION` | `auto` (pour R2) |
   | `PHOTO_BACKUP_S3_BUCKET` | `spotto-copie-photos` |
   | `PHOTO_BACKUP_S3_ACCESS_KEY_ID` | l'Access Key ID de l'étape 2.6 |
   | `PHOTO_BACKUP_S3_SECRET_ACCESS_KEY` | la Secret Access Key de l'étape 2.6 ⚠️ clé secrète |

8. **Premier passage, en essai** : bouton **Trigger Run** (à vérifier), puis lisez le journal (**Logs**). Il doit afficher une ligne par bucket, avec « à copier ». Rien n'est encore écrit.
9. Remplacez la **Command** par `pnpm --filter backend sauvegarder-photos`, sans `--essai`, puis **Trigger Run**. Le premier passage copie toutes les photos. Les suivants ne copient que les nouvelles.
10. Vérifiez chez Cloudflare : le bucket contient trois dossiers, `vault-media`, `post-media` et `avatars`.
11. Notifications : Render → **Settings** du compte → **Notifications**. Vérifiez que les échecs vous sont envoyés par e-mail (à vérifier). Un passage en échec, c'est soit le garde-fou, soit une panne : section 4.

ⓘ Le script refuse de démarrer s'il manque une variable, et il en donne le nom, jamais la valeur. Il refuse aussi une copie placée dans le projet Supabase qu'elle protège.

## 4. Quand un passage échoue

Le journal du passage dit pourquoi. Il y a trois cas.

**« Réglages manquants ou invalides »** : une variable de la section 3.7 manque ou est mal saisie. Corrigez-la, puis **Trigger Run**.

**« lecture … impossible » ou « copies échouées »** : panne passagère chez Supabase ou chez Cloudflare. Relancez une fois avec **Trigger Run**. Si l'échec revient, copiez le journal à Claude. Rien n'est effacé tant qu'une lecture est incomplète.

**« Purge bloquée par le garde-fou »** (code 2) : le passage voulait effacer de la copie **plus de 50 photos, et plus de 10 %** de la copie d'un bucket. Ou Supabase ne contenait plus aucune photo dans un bucket. Rien n'a été effacé. Les nouvelles photos ont quand même été copiées.

1. Regardez Supabase → spotto-prod → **Storage**. Les photos sont-elles toujours là ?
2. **Elles ont disparu, sans raison connue** : ne touchez à rien. La copie est intacte. Prévenez Claude, puis restaurez (section 5).
3. **C'est normal** (par exemple, beaucoup de comptes supprimés la même semaine) : lancez une fois la Command `pnpm --filter backend sauvegarder-photos --autoriser-purge`, avec **Trigger Run**. Remettez ensuite la Command habituelle.

## 5. Restaurer des photos

La restauration remet dans Supabase les photos de la copie qui y manquent. **Elle ne remplace jamais une photo présente.**

1. Dans la tâche planifiée, mettez la Command `pnpm --filter backend sauvegarder-photos --restaurer`, puis **Trigger Run**. C'est un **essai** : le journal dit combien de photos manquent, sans rien écrire.
2. Pour restaurer pour de bon : Command `pnpm --filter backend sauvegarder-photos --restaurer --confirmer`, puis **Trigger Run**.
3. **Remettez la Command habituelle** (`pnpm --filter backend sauvegarder-photos`).

Pour viser plus petit, ajoutez `--bucket vault-media` (ou `post-media`, `avatars`), et `--dossier <identifiant du compte>` pour un seul compte.

ⓘ Par sécurité, la restauration refuse tout fichier de la copie qui n'a pas la forme d'une photo de Spotto : un nom inattendu, ou un type autre qu'une image (JPEG, PNG, WebP, HEIC, GIF). Le journal compte ces refus. S'il y en a, prévenez Claude : la copie a peut-être été abîmée.

ⓘ Après une restauration de la base (RESTAURATION.md, section 3), restaurez aussi les photos. Une photo dont la fiche n'existe plus dans la base reste dans le stockage, invisible, sans gêner le service.

⚠️ Restaurer les photos d'un compte supprimé ferait revenir des données que la personne a demandé d'effacer. Avant de viser un compte précis, vérifiez qu'il existe encore.

## 6. Ce que la copie change pour les données personnelles

À transmettre à l'avocat, avec les autres prestataires (point 7 de la feuille de route) :

- **un prestataire de plus** : le service de stockage choisi (Cloudflare avec R2), qui garde une copie des photos, dans l'Union européenne avec la juridiction EU ;
- **durée de conservation** : une photo effacée de Spotto reste dans la copie **7 jours au plus**, jusqu'au passage suivant. Plus longtemps si le garde-fou bloque une purge, le temps de la débloquer (section 4) ;
- la copie n'est lisible qu'avec la clé de la section 2, rangée dans Render.
