# Registre des migrations

*Lot « filets de sécurité », point 31 de la feuille de route V1. État au 6 novembre 2026.*

Une **migration** est un fichier SQL qui fait évoluer la structure de la base de données. Les fichiers sont dans `apps/backend/supabase/migrations/`, numérotés dans l'ordre où il faut les appliquer.

La base de production s'appelle **spotto-prod** : l'adresse de son éditeur SQL contient `selhqdqfrflsqivgxypf`. Elle est en service depuis le **28 octobre 2026**. Les migrations y sont appliquées à la main, dans l'éditeur SQL de Supabase ; rien dans la base ne garde la liste de celles qui sont passées. **Ce registre est donc la référence** : mettez-le à jour (ou demandez-le à Claude) à chaque migration appliquée. La marche à suivre est dans [MISE-EN-LIGNE.md](../../../MISE-EN-LIGNE.md).

Les dates de 0001 à 0028 ne sont pas notées dans le dépôt : celles du tableau sont déduites des notes de travail. Corrigez-les avec vos propres notes si elles sont plus précises.

## Tableau

| N° | Ce qu'elle fait | État en production | Date en production |
|---|---|---|---|
| 0001 | Schéma de départ : profils, abonnements, recherches, Vault, publications… | appliquée en production | au plus tard le 28 oct. 2026 |
| 0002 | Crée le profil à l'inscription | appliquée en production | au plus tard le 28 oct. 2026 |
| 0003 | Espace de stockage privé des images analysées | appliquée en production | au plus tard le 28 oct. 2026 |
| 0004 | Droits du serveur sur les tables | appliquée en production | au plus tard le 28 oct. 2026 |
| 0005 | Espace de stockage des photos du Vault | appliquée en production | au plus tard le 28 oct. 2026 |
| 0006 | Espace de stockage des photos publiées | appliquée en production | au plus tard le 28 oct. 2026 |
| 0007 | Recherche à partir d'une photo seule | appliquée en production | au plus tard le 28 oct. 2026 |
| 0008 | Envies (« Garder ») | appliquée en production | au plus tard le 28 oct. 2026 |
| 0009 | Espace de stockage des photos de profil | appliquée en production | au plus tard le 28 oct. 2026 |
| 0010 | Notifications dans l'app | appliquée en production | au plus tard le 28 oct. 2026 |
| 0011 | Blocages et signalements | appliquée en production | au plus tard le 28 oct. 2026 |
| 0012 | Clics vers les marchands, sans adresse IP | appliquée en production | au plus tard le 28 oct. 2026 |
| 0013 | Pièces taguées dans les publications | appliquée en production | au plus tard le 28 oct. 2026 |
| 0014 | Retirer du Vault un objet déjà publié | appliquée en production | au plus tard le 28 oct. 2026 |
| 0015 | Images haute définition des résultats | appliquée en production | au plus tard le 28 oct. 2026 |
| 0016 | Vault toujours privé | appliquée en production | au plus tard le 28 oct. 2026 |
| 0017 | Commentaires | appliquée en production | au plus tard le 28 oct. 2026 |
| 0018 | Miniatures des photos publiées | appliquée en production | au plus tard le 28 oct. 2026 |
| 0019 | Version du texte accepté (CGU, politique) | appliquée en production | au plus tard le 28 oct. 2026 |
| 0020 | Accord « statistiques d'usage » | appliquée en production | au plus tard le 28 oct. 2026 |
| 0021 | Accord « analyse automatique de la vidéo » | appliquée en production | au plus tard le 28 oct. 2026 |
| 0022 | Plafond global des recherches SerpApi | appliquée en production | au plus tard le 28 oct. 2026 |
| 0023 | Modération (administrateurs) | appliquée en production | au plus tard le 28 oct. 2026 |
| 0024 | Partager une envie | appliquée en production | au plus tard le 28 oct. 2026 |
| 0025 | Mesure de chaque recherche, bouton « Résultat incohérent » | appliquée en production | au plus tard le 28 oct. 2026 |
| 0026 | « Retirer l'image copiée » (modération) | appliquée en production | au plus tard le 28 oct. 2026 |
| 0027 | Fournisseur de recherche, place rendue, disjoncteurs, recherche par texte | appliquée en production | au plus tard le 28 oct. 2026 |
| 0028 | Voie C (compléments « boutiques », cache) | appliquée en production | 3 ou 4 nov. 2026 (à confirmer) |
| 0029 | Garde-fous : index, compteurs de l'IA dans la base, part du jour plus juste | **à appliquer** | — |
| 0030 | Masquage automatique après 3 signalements | **à appliquer** | — |
| 0031 | Boutiques ensuite : résultats Lens tout de suite, autres boutiques juste après | **à appliquer** | — |
| 0032 | Messages privés entre membres (conversations, invitations, envie jointe) | **à appliquer** | — |

## Fichiers utiles par migration

| N° | Fichier de mise en production | Vérification (lecture seule) | Retour en arrière |
|---|---|---|---|
| 0022 à 0024 | `supabase/mise-en-ligne/lot-5-production.sql` (déjà passé : **ne plus le relancer en entier**) | `supabase/mise-en-ligne/lot-5-verification.sql`, `supabase/verifications/0024-verification.sql` | — |
| 0027 | — | — | `docs/0027-retour.sql` (sur votre Mac, hors dépôt) |
| 0028 | `supabase/mise-en-ligne/voie-c-production.sql` (déjà passé) | `supabase/verifications/0028-verification.sql` | `docs/0028-retour.sql` (sur votre Mac, hors dépôt) |
| 0029 | le fichier de la migration lui-même | — (à demander à Claude si besoin) | en tête du fichier de la migration |
| 0030 | le fichier de la migration lui-même | `supabase/verifications/0030-verification.sql` | — (à demander à Claude si besoin) |
| 0031 | le fichier de la migration lui-même | `supabase/verifications/0031-verification.sql` | en tête du fichier de la migration |
| 0032 | le fichier de la migration lui-même (**après 0030** ; ne pas relancer 0030 ensuite) | `supabase/verifications/0032-verification.sql` | en tête du fichier de la migration |

## Avant d'appliquer 0029, 0030, 0031 et 0032

1. **L'offre Supabase Pro sur spotto-prod** (sauvegardes quotidiennes), comme décidé dans la feuille de route : aucun nouveau SQL en production avant. Que faire si ça tourne mal : [RESTAURATION.md](RESTAURATION.md).
2. Chacune a d'abord été appliquée sur **spotto-dev-2** (`pnpm --filter backend migrer-dev …`, sur votre Mac), puis vérifiée.
3. Le serveur fonctionne avec ou sans elles : sans 0029, il garde ses compteurs de l'IA en mémoire ; sans 0030, il ne masque rien automatiquement ; sans 0031, il cherche les autres boutiques avant de répondre, comme avant (la nouvelle app attend alors le même temps qu'aujourd'hui) ; sans 0032, les messages sont « indisponibles » et l'app cache l'entrée Messages. Un serveur plus ancien fonctionne aussi sur une base qui les a.
4. Toutes sont rejouables : relancer le fichier une seconde fois ne change rien.

Une fois appliquée, changez sa ligne : « appliquée en production », avec la date.
