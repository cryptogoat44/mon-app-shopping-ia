# Mettre en ligne, vérifier, revenir en arrière

*Lot « filets de sécurité », point 24 de la feuille de route V1. Pour le fondateur. Les mentions « à vérifier » signalent ce qui n'a pas pu être contrôlé depuis les outils de Claude (ils n'ont pas accès à Render) : regardez la première fois, puis corrigez cette page.*

## Ce qui est en ligne

| Pièce | Où | Adresse |
|---|---|---|
| La base de données | Supabase, projet **spotto-prod** (l'adresse contient `selhqdqfrflsqivgxypf`) | — |
| Le serveur | Render, service **spotto-api** | https://spotto-api.onrender.com |
| Le site | Render, service **mon-app-shopping-ia-web** | https://mon-app-shopping-ia-web.onrender.com |
| L'app iPhone | Expo (EAS), puis TestFlight / App Store | — |

**Render ne publie jamais tout seul.** Rien ne part en ligne tant que vous n'avez pas cliqué. Et un clic envoie toujours **le dernier état de `main`** sur GitHub.

## Avant de commencer (5 minutes)

1. **Les vérifications de GitHub sont vertes** sur le dernier commit de `main` : https://github.com/cryptogoat44/mon-app-shopping-ia/actions. Il faut voir en vert « Types, tests de l'app, compilation » et « Tests serveur hors base ». « Tests serveur (spotto-dev-2) » reste rouge tant que ses deux secrets ne sont pas ajoutés : c'est voulu.
2. **Notez la version en service** : ouvrez https://spotto-api.onrender.com/health. La page affiche par exemple `{"status":"ok","version":"a0212c1"}`. Ces 7 caractères désignent la version du code. Notez-les : c'est la version à laquelle revenir en cas de souci.
3. **Une sauvegarde existe** (avec l'offre Supabase Pro) : Supabase → spotto-prod → **Database** → **Backups**. Il doit y en avoir une de la nuit (à vérifier).
4. Choisissez un moment calme : pas pendant une démonstration.

## L'ordre : base, serveur, site, iPhone

1. **Les migrations** (la base), s'il y en a de nouvelles.
2. **Le serveur** (spotto-api).
3. **Le site** (mon-app-shopping-ia-web), depuis **le même commit** que le serveur.
4. **L'iPhone**, seulement si le code de l'app a changé.

*Pourquoi cet ordre.* Chaque migration est écrite pour que le serveur déjà en ligne continue de marcher avec la base migrée. Le nouveau serveur trouve donc la base prête. Le site, lui, suit le serveur, dont il appelle les nouvelles adresses. Enfin, les iPhone déjà installés gardent leur version : le serveur doit rester compatible avec eux.

**Une exception** : quand le fichier de mise en production d'une migration (dossier `apps/backend/supabase/mise-en-ligne/`) indique un autre ordre, suivez ce fichier. Exemple : pour 0028, il fallait mettre en ligne le serveur et le site d'abord.

## 1. Les migrations

1. Ouvrez [le registre des migrations](apps/backend/supabase/REGISTRE-MIGRATIONS.md). N'appliquez que celles marquées « à appliquer », **dans l'ordre des numéros**, et seulement si elles sont déjà passées sur spotto-dev-2.
2. supabase.com → projet **spotto-prod**. Vérifiez que l'adresse de la page contient `selhqdqfrflsqivgxypf`.
3. Menu **SQL Editor** → **New query**. Collez **tout** le fichier de la migration, puis cliquez **Run**. Si Supabase affiche « destructive operation », lisez l'en-tête du fichier : s'il prévient de cet avertissement, cliquez **Run this query** ; sinon, arrêtez et demandez à Claude.
4. Si la migration a un fichier de vérification (voir le registre), collez-le dans une nouvelle requête, puis **Run**. Comparez avec le « résultat attendu » écrit en tête de ce fichier.
5. Dans le registre, notez « appliquée en production » et la date.

Si quelque chose se passe mal : section 8.

## 2. Le serveur

1. https://dashboard.render.com → service **spotto-api**.
2. En haut à droite : **Manual Deploy** → **Deploy latest commit**.
3. Onglet **Events** : attendez la ligne « Deploy live » (quelques minutes). Si la ligne dit « failed », rien n'a changé : l'ancienne version reste en service. Copiez le message à Claude.
4. Ouvrez https://spotto-api.onrender.com/health : la `version` doit être celle du dernier commit de `main` (les 7 premiers caractères, visibles sur GitHub à côté du message du commit, et dans Render, dans la ligne « Deploy live »).

Même chose en ligne de commande, sur le Mac : `pnpm --filter backend render-bride deployer spotto-api --confirmer`, puis la commande `suivre` qu'il affiche.

*Après un changement de variable* dans Render (**Environment**), Render propose de redéployer ou d'enregistrer seulement (à vérifier). Une variable ne compte qu'après un nouveau déploiement.

## 3. Le site

1. Render → service **mon-app-shopping-ia-web**.
2. **Manual Deploy** → **Deploy latest commit**. Si une variable du site a changé depuis la dernière fois, choisissez plutôt **Clear build cache & deploy** : sinon, l'ancienne valeur peut rester dans le site.
3. Attendez « Deploy live », sur **le même commit** que le serveur.
4. Ouvrez le site et rechargez la page. Les onglets restés ouverts affichent d'eux-mêmes le bandeau « nouvelle version ».

## 4. L'iPhone

Voir [apps/mobile/BUILD-IPHONE.md](apps/mobile/BUILD-IPHONE.md), sections 5 et 6 :
- correction du code de l'app seulement : une mise à jour à distance (`eas update`), **après** le serveur et le site ;
- changement natif (nouveau module, nouvelle autorisation) : un nouveau build, puis la validation d'Apple.

Pour un build envoyé à la validation d'Apple : la liste de contrôle, la fiche, les notes de validation et les réponses « App Privacy » sont dans [apps/mobile/app-store/](apps/mobile/app-store/README.md).

Les iPhone déjà installés gardent leur version jusqu'à la mise à jour. N'obligez une mise à jour (`APP_MIN_IOS_BUILD`) qu'une fois le nouveau build disponible sur l'App Store.

## 5. Vérifier la version servie

- https://spotto-api.onrender.com/health : `"version"` = les 7 premiers caractères du commit en service. Comparez avec la liste des commits de `main` sur GitHub, ou avec la ligne « Deploy live » de Render.
- `"version": null` : Render n'a pas transmis le commit. Le serveur lit la variable `RENDER_GIT_COMMIT`, que Render remplit lui-même (nom à vérifier dans la documentation de Render). Dites-le à Claude ; rien n'est cassé pour autant.
- https://spotto-api.onrender.com/health/deep : `"status":"ok"` veut dire que le serveur **et** la base répondent.
- Essai rapide : connectez-vous au site, ouvrez le fil et les Envies. Une recherche Spotter coûte un crédit SerpApi : une seule suffit. Dans Sentry, aucune nouvelle erreur ne doit apparaître.

Le serveur ne renvoie rien d'autre que `status` et `version` : ni réglage, ni clé, ni nom de service.

## 6. Poser l'étiquette de version

Une étiquette par mise en ligne, sur GitHub. Elle dit quelle version était en ligne, et depuis quel jour. Sur le Mac, dans le dossier du projet :

```bash
git pull
pnpm --filter backend etiqueter-version a0212c1              # dit ce qu'elle ferait
pnpm --filter backend etiqueter-version a0212c1 --confirmer  # pose l'étiquette et l'envoie
```

Remplacez `a0212c1` par la `version` affichée par /health. L'étiquette s'appelle `v2026.11.06-1` : la date de Paris, puis le numéro de la mise en ligne du jour (`-2` pour la deuxième). La commande refuse un commit qui n'est pas dans `main`, et n'efface jamais rien. Liste des étiquettes : https://github.com/cryptogoat44/mon-app-shopping-ia/tags.

## 7. Revenir en arrière

### Le serveur ou le site

1. Render → le service concerné → onglet **Events**.
2. Retrouvez la mise en ligne précédente (« Deploy live »), celle de la version notée avant de commencer.
3. Cliquez **Rollback** à côté d'elle, puis confirmez (à vérifier : nom exact du bouton).
4. Attendez « Deploy live ». Vérifiez dans /health que la `version` est revenue à l'ancienne.
5. Si le souci touche le serveur **et** le site, revenez en arrière sur les deux, vers le même commit.

Render remet en ligne l'ancienne construction telle quelle (à vérifier : avec les variables d'aujourd'hui ou celles d'alors). Ensuite, prévenez Claude : la correction passera par `main`, puis par une nouvelle mise en ligne.

⚠️ **Ne revenez qu'à la version qui tournait juste avant**, jamais plus loin. Chaque migration est prévue pour le serveur qui était en ligne quand elle a été appliquée, pas pour les plus anciens. Exemple : tant que 0028 est appliquée, ne remettez jamais un serveur d'avant le 3 novembre 2026.

### La base

Ne défaites jamais une migration à la main. Le plus souvent, revenir en arrière sur le serveur suffit : l'ancien serveur fonctionne avec la base migrée. Si une migration doit vraiment être défaite, son script de retour est indiqué dans le registre. Faites-le avec Claude, une étape à la fois.

### Tout restaurer

En dernier recours (données abîmées), avec l'offre Supabase Pro : Supabase → spotto-prod → **Database** → **Backups** → **Restore**, sur la sauvegarde de la nuit (à vérifier). Tout ce qui a été fait depuis cette sauvegarde est perdu : comptes créés, recherches, publications. La procédure complète est dans [apps/backend/supabase/RESTAURATION.md](apps/backend/supabase/RESTAURATION.md) : quand restaurer, comment, et ce qu'il faut rejouer ensuite. Les photos se restaurent à part : [apps/backend/supabase/SAUVEGARDE-PHOTOS.md](apps/backend/supabase/SAUVEGARDE-PHOTOS.md).

## 8. Si une migration échoue

1. **Pas de panique** : le site continue de marcher. Le serveur fonctionne sans la nouvelle migration (chacune est écrite ainsi).
2. **En général, rien n'a changé** : une erreur annule tout le fichier. Pour en être sûr, lancez son fichier de vérification, s'il existe (à vérifier la première fois).
3. **Copiez le message d'erreur** (le texte rouge) et donnez-le à Claude. Il ne contient aucun secret. N'essayez pas d'autres commandes au hasard.
4. Si l'éditeur répond ensuite « current transaction is aborted », lancez seulement `rollback;`, puis arrêtez-vous là.
5. « could not obtain lock » : une recherche utilisait la table à cet instant. Relancez le fichier quelques secondes plus tard.
6. Une fois la cause réglée, relancez **tout** le fichier : les migrations 0029 et 0030 sont rejouables. Attention : `lot-5-production.sql`, lui, ne doit plus jamais être relancé en entier.
7. Tant que la migration n'est pas passée, n'allumez pas ce qui en dépend (interrupteurs de Render).
8. Si la migration est passée mais que le site se comporte mal : revenez d'abord en arrière sur le serveur (section 7), puis prévenez Claude.

## Carnet d'incidents

Les alertes, et où les recevoir : [apps/backend/ALERTES.md](apps/backend/ALERTES.md).

| Ce qu'on voit | Ce qu'on fait |
|---|---|
| Le site ou l'app ne répond plus | Ouvrez /health. Pas de réponse : Render → spotto-api → **Logs** et **Events**. En offre gratuite, la première réponse après une pause peut prendre 50 secondes. Juste après une mise en ligne : **Rollback** (section 7). |
| /health répond, mais /health/deep donne « degraded » | La base ne répond pas. Regardez le tableau de bord de Supabase (projet en pause ? panne ?) et https://status.supabase.com. Rien à faire sur Render. |
| Alerte « disjoncteur » : recherche en pause | Le fournisseur de recherche (SerpApi) est en panne. La recherche reprend seule après la pause. Rien à mettre en ligne. |
| Alerte « plafond_recherches » : Spotter fermé à tous | Le plafond du jour ou du mois est atteint. Il se libère seul (le lendemain, ou au renouvellement du quota). Pour le relever : variables `SERPAPI_DAILY_CAP` et `SERPAPI_MONTHLY_CAP` de spotto-api, sans dépasser le quota de votre offre SerpApi. |
| Alerte « plafond_ia » | 300 analyses de l'IA dans la journée : reprise le lendemain. |
| Alerte « echecs_repetes » | L'IA ou Google Shopping échoue. Pour couper la voie C : `VOIE_C_AI_ENABLED`, puis `VOIE_C_ENABLED` (Render → spotto-api → **Environment**), puis un redéploiement. |
| Alerte « signalement » ou « masquage_auto » | Traitez-le dans l'app (Réglages → Modération) en moins de 24 heures. |
| Une mise en ligne casse quelque chose | **Rollback** (section 7), puis prévenez Claude. |
| Une migration échoue | Section 8. |
| Données perdues ou abîmées | Tout restaurer (section 7), en dernier recours. |
