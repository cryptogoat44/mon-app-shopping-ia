# Restaurer la base de production

*Point 10 de la feuille de route V1 (les sauvegardes). État au 6 novembre 2026.*

Cette page dit quoi faire si la base de production (**spotto-prod**, adresse contenant `selhqdqfrflsqivgxypf`) perd des données ou se retrouve abîmée : une fausse manipulation dans l'éditeur SQL, une migration qui tourne mal ou une suppression en trop.

> ⓘ **À retenir**
> - Les sauvegardes quotidiennes n'existent qu'avec l'**offre Pro** de Supabase. Sur l'offre gratuite, il n'y a aucune sauvegarde à restaurer depuis le tableau de bord.
> - Une restauration **remplace toute la base** par son état au moment de la sauvegarde. Tout ce qui s'est passé depuis est perdu : nouveaux comptes, recherches, publications.
> - Les **photos ne sont pas dans les sauvegardes**. Vault, publications et photos de profil sont dans le stockage de Supabase, et la base ne garde que leur fiche. Une photo supprimée ne revient pas.

⚠️ Les noms de menus ci-dessous viennent de la documentation de Supabase relue le 6 novembre 2026 : <https://supabase.com/docs/guides/platform/backups>. L'interface change souvent : en cas de doute, cette page fait foi.

## 1. Avant tout SQL en production

1. Vérifiez que spotto-prod est bien en offre Pro : tableau de bord Supabase → **Database** → **Backups**. Vous devez y voir une sauvegarde datée de moins de 24 heures. Pas de sauvegarde visible ? Ne lancez pas le SQL. Prévenez Claude.
2. Notez l'heure de la dernière sauvegarde. C'est le point de retour possible.
3. Faites passer le SQL sur **spotto-dev-2** d'abord, sur votre Mac : `pnpm --filter backend migrer-dev …`. C'est la règle de [MISE-EN-LIGNE.md](../../../MISE-EN-LIGNE.md).
4. Après le SQL, cochez la migration dans le [registre](REGISTRE-MIGRATIONS.md).

## 2. Quand quelque chose a mal tourné

**D'abord, ne rien aggraver.** Ne relancez pas de SQL au hasard. Arrêtez-vous, notez l'heure et ce que vous avez fait, puis prévenez Claude.

Ensuite, choisissez la bonne réponse. Elle dépend de l'ampleur du problème.

| Situation | Réponse | Données perdues |
|---|---|---|
| Le nouveau serveur se comporte mal, la base va bien | Revenir à la version précédente du serveur (voir [MISE-EN-LIGNE.md](../../../MISE-EN-LIGNE.md), « Revenir en arrière ») | Aucune |
| Quelques lignes fausses ou effacées (un compte, une publication) | Une correction ciblée en SQL, écrite par Claude et essayée d'abord sur spotto-dev-2 | Aucune, ou seulement ces lignes |
| Une migration à défaire | Son script de retour (voir le registre), avec Claude, une étape à la fois | Ce que la migration avait ajouté |
| Une table entière abîmée, ou beaucoup de données perdues | **Restaurer la sauvegarde** (section 3) | Tout ce qui a changé depuis la sauvegarde |

La restauration est le dernier recours, parce qu'elle efface tout ce que les gens ont fait depuis la sauvegarde.

## 3. Restaurer une sauvegarde quotidienne

⚠️ **Action irréversible.** La base actuelle est remplacée. Ne le faites qu'après en avoir parlé avec Claude.

1. **Mettez le service en pause** pendant l'opération, pour que personne n'écrive dans une base qui va être remplacée : Render → **spotto-api** → **Suspend Service** (à vérifier dans Render). Le site reste en ligne, mais l'app affichera une panne.
2. Tableau de bord Supabase → **Database** → **Backups** → **Scheduled backups**. Choisissez la sauvegarde d'avant l'incident, puis **Restore**, et confirmez.
3. Attendez. Le projet est indisponible pendant la restauration, de quelques minutes à plus longtemps selon la taille de la base. Supabase prévient quand c'est fini.
4. **Rejouez les migrations appliquées après la sauvegarde.** Comparez l'heure de la sauvegarde aux dates du [registre](REGISTRE-MIGRATIONS.md). Toute migration passée en production après cette heure est absente de la base restaurée. Rejouez-la dans l'ordre ; elles sont rejouables.
5. **Vérifiez** : lancez les fichiers de vérification en lecture seule de `supabase/verifications/`, puis ouvrez `https://spotto-api.onrender.com/health/deep` une fois le serveur relancé.
6. **Relancez le serveur** : Render → spotto-api → **Resume Service**.
7. Notez l'incident dans le carnet d'incidents de [MISE-EN-LIGNE.md](../../../MISE-EN-LIGNE.md) : quoi, quand, la sauvegarde utilisée, ce qui a été perdu.

ⓘ Si des comptes ont été créés entre la sauvegarde et l'incident, ils n'existent plus dans la base restaurée. Leurs propriétaires devront se réinscrire. Des photos envoyées pendant cette période peuvent rester dans le stockage, sans fiche ; elles ne gênent pas le service.

## 4. L'essai de restauration (une fois, puis une fois par an)

Une procédure jamais essayée ne vaut pas grand-chose. Le plus sûr est de restaurer **dans un nouveau projet**, sans toucher spotto-prod :

1. Database → Backups → **Restore to a new project**, si l'option est proposée (à vérifier : elle était annoncée « en essai » par Supabase).
2. Dans le nouveau projet, ouvrez l'éditeur SQL et comptez les lignes de quelques tables (`profiles`, `searches`, `posts`). Les chiffres doivent être proches de ceux de spotto-prod.
3. **Supprimez ce projet d'essai** une fois vérifié. 💶 Un projet de plus est facturé tant qu'il existe : quelques centimes pour une heure (à vérifier sur la page des prix de Supabase).

spotto-dev-2 est en offre gratuite : on ne peut pas y faire cet essai.

## 5. Les photos

Les sauvegardes de la base ne contiennent aucune photo. Le point 10 de la feuille de route prévoit une copie hebdomadaire des photos vers un stockage privé, qui effacerait aussi de cette copie les photos des comptes supprimés. Elle attend le choix de ce stockage. D'ici là, une photo supprimée par erreur ne peut pas être récupérée.
