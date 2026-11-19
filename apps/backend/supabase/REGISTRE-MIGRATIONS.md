# Registre des migrations

*Lot « filets de sécurité », point 31 de la feuille de route V1. État au 19 novembre 2026.*

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
| 0029 | Garde-fous : index, compteurs de l'IA dans la base, part du jour plus juste | appliquée en production (fichier groupé `prod-1-…-production.sql`, après une copie de secours complète ; vérification juste) | 15 nov. 2026 |
| 0030 | Masquage automatique après 3 signalements | appliquée en production (fichier groupé `social-production.sql`, sans Supabase Pro : décision du fondateur) | 9 nov. 2026 |
| 0031 | Boutiques ensuite : résultats Lens tout de suite, autres boutiques juste après | appliquée en production (sans Supabase Pro : décision du fondateur, 3 colonnes vides ajoutées) | 9 nov. 2026 |
| 0032 | Messages privés entre membres (conversations, invitations, envie jointe) | appliquée en production (fichier groupé `social-production.sql`, sans Supabase Pro : décision du fondateur) | 9 nov. 2026 |
| 0033 | Collections d'envies, privées ou montrées aux amis | appliquée en production (fichier groupé `social-production.sql`, sans Supabase Pro : décision du fondateur) | 9 nov. 2026 |
| 0034 | Modération des collections : les signaler, les masquer, retirer une image copiée | appliquée en production (fichier groupé `social-production.sql`, sans Supabase Pro : décision du fondateur) | 9 nov. 2026 |
| 0035 | Notifications des nouveaux messages sur le téléphone : les appareils prévenus | appliquée en production (fichier groupé `prod-1-…-production.sql`, après une copie de secours complète ; vérification juste) | 15 nov. 2026 |
| 0036 | Alertes prix et stock : suivi des envies, cloches, alertes, « Plus disponible » | appliquée en production (fichier groupé `prod-3-…-production.sql`, après une copie de secours complète ; vérification juste) | 15 nov. 2026 |
| 0037 | Modération des profils : un administrateur peut retirer une bio ou une photo de profil | appliquée en production (fichier groupé `prod-1-…-production.sql`, après une copie de secours complète ; vérification juste) | 15 nov. 2026 |
| 0038 | Mémoire collective des vidéos TikTok et Instagram (mission « liens vidéo ») : vidéos, spots, pièces repérées, confirmations | appliquée en production (fichier groupé `prod-2-…-production.sql`, après une copie de secours complète ; vérification juste) | 15 nov. 2026 |
| 0039 | Garde-fous de la mémoire des vidéos (revue de sécurité) : seuil de 2 membres, un spot par membre et par vidéo, comptes suspendus ignorés, retrait par l'administrateur ; suppression d'un compte réparée (`security definer`) | appliquée en production (fichier groupé `prod-2-…-production.sql`, après une copie de secours complète ; vérification juste) | 15 nov. 2026 |
| 0040 | Garde-fous des alertes prix et stock (revue de sécurité) : « Plus disponible » d'un seul membre ne touche que ses envies, pas de « De retour en stock » après des signalements, une envie par membre et par pièce, pays du membre, achat reconnu par pièce | appliquée en production (fichier groupé `prod-3-…-production.sql`, après une copie de secours complète ; vérification juste) | 15 nov. 2026 |
| 0041 | Alertes, nouvelle version : seuil de prix choisi par le membre, stock et rupture comparés pays par pays (Google, ou 3 membres d'affilée du même pays ; pays de la recherche gardé avec chaque signalement), « Aider les autres membres », un achat ne sert plus aux alertes des autres, jours seulement (aucune heure gardée hors envoi, réservations échues effacées à chaque passage), notification générique | appliquée en production (fichier groupé `prod-3-…-production.sql`, après une copie de secours complète ; vérification juste) | 15 nov. 2026 |
| 0042 | Essayage virtuel photo, ÉTEINT : drapeau des fonctions, statut d'âge et consentement, essais (sans aucune image), essais offerts, signalements, alertes et compteurs du budget | appliquée en production (le fichier de la migration, après une copie de secours complète ; vérification juste ; drapeau `tryon` allumé à la demande du fondateur) | 15 nov. 2026 |
| 0043 | Confirmations de lecture des messages privés : le réglage « Confirmations de lecture » de chaque membre, allumé par défaut (« Vu » ou « Envoyé » sous son dernier message, dans une conversation ouverte), et le moment à partir duquel ses lectures peuvent être montrées (jamais une lecture d'avant la migration, ni une lecture faite pendant que le réglage était éteint) | appliquée en production (le fichier de la migration, après une copie de secours complète et après la mise en ligne du serveur, du site et de la politique qui portent « Vu » ; vérification juste, six `true`) | 19 nov. 2026 |
| 0044 | Messages, plus de confort : aimer un message (❤️), répondre à un message précis, supprimer un de ses messages (« Message supprimé » pour les deux membres ; le contenu d'un message déjà signalé reste dans la base, pour la modération seulement), envoyer une publication du fil (jamais recopiée : montrée seulement à qui a le droit de la voir, au moment où il regarde) | appliquée en production (le fichier de la migration, après une copie de secours complète, juste après 0043 ; vérification juste, sept `true`) | 19 nov. 2026 |

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
| 0033 | le fichier de la migration lui-même | `supabase/verifications/0033-verification.sql` | en tête du fichier de la migration |
| 0034 | le fichier de la migration lui-même (**après 0030, 0032 et 0033** ; ne pas relancer 0030 ni 0032 ensuite) | `supabase/verifications/0034-verification.sql` | en tête du fichier de la migration |
| 0030, 0032, 0033 et 0034 ensemble | `supabase/mise-en-ligne/social-production.sql` (un seul copier-coller, dans le bon ordre, rejouable en entier ; vérifié deux fois sur spotto-dev-2 le 9 nov. 2026) | `supabase/mise-en-ligne/social-verification.sql` (4 lignes, toutes `true`) | en tête de chaque migration, dans l'ordre inverse |
| 0035 | le fichier de la migration lui-même | `supabase/verifications/0035-verification.sql` | en tête du fichier de la migration |
| 0036 | le fichier de la migration lui-même (**après 0035**) ; puis, une fois, le script `pnpm --filter backend rattraper-suivi-envies-dev` pour les envies déjà là | `supabase/verifications/0036-verification.sql` | en tête du fichier de la migration |
| 0037 | le fichier de la migration lui-même | `supabase/verifications/0037-verification.sql` (une ligne, trois `true`) | en tête du fichier de la migration |
| 0038 | le fichier de la migration lui-même | pas de fichier à part : `supabase/mise-en-ligne/prod-2-memoire-videos-verification.sql` vérifie 0038 et 0039 ensemble ; tests `memoireVideos.test.ts` (base) et `migrationSuppressionCompte.test.ts` | en tête du fichier de la migration |
| 0039 | le fichier de la migration lui-même (**après 0038**) | pas de fichier à part : le même que pour 0038 ; mêmes tests | en tête du fichier de la migration |
| 0040 | le fichier de la migration lui-même (**après 0036**) | `supabase/verifications/0040-verification.sql` (une ligne, cinq `true`) | en tête du fichier de la migration |
| 0041 | le fichier de la migration lui-même (**après 0040**) ; puis, une fois, le script `pnpm --filter backend rattraper-suivi-envies-dev` (il recalcule les empreintes des envies, version 2) | `supabase/verifications/0041-verification.sql` (une ligne, six `true`) | en tête du fichier de la migration |
| 0042 | le fichier de la migration lui-même | `supabase/verifications/0042-verification.sql` (une ligne, huit `true`) | en tête du fichier de la migration |
| 0043 | le fichier de la migration lui-même (**après 0032** ; sur spotto-prod, **après la mise en ligne** du serveur, de l'app et de la politique) | `supabase/verifications/0043-verification.sql` (une ligne, six `true`) | en tête du fichier de la migration |
| 0044 | le fichier de la migration lui-même (**après 0032**) | `supabase/verifications/0044-verification.sql` (une ligne, sept `true`) | en tête du fichier de la migration (**il efface des messages** : les messages supprimés et ceux qui ne portent qu'une publication) |
| 0029, 0035 et 0037 ensemble | `supabase/mise-en-ligne/prod-1-technique-production.sql` (un seul copier-coller, rejouable en entier ; rien de visible pour les membres ; **avant** prod-3) | `supabase/mise-en-ligne/prod-1-technique-verification.sql` (3 lignes, toutes `true`) | en tête de chaque migration, dans l'ordre inverse |
| 0038 et 0039 ensemble | `supabase/mise-en-ligne/prod-2-memoire-videos-production.sql` (un seul copier-coller, rejouable en entier ; « Pièces déjà repérées dans cette vidéo ») | `supabase/mise-en-ligne/prod-2-memoire-videos-verification.sql` (une ligne, tout `true`) | en tête de chaque migration, dans l'ordre inverse |
| 0036, 0040 et 0041 ensemble | `supabase/mise-en-ligne/prod-3-alertes-production.sql` (un seul copier-coller, **après prod-1** : refusé sans 0035 ; alertes prix et stock ; une fois passé, une seconde exécution est arrêtée par sa garde, sans rien changer ; le script de rattrapage, qui ne vise que spotto-dev-2, n'y est pas nécessaire : voir l'en-tête) | `supabase/mise-en-ligne/prod-3-alertes-verification.sql` (3 lignes, toutes `true`) | en tête de chaque migration, dans l'ordre inverse |

## Avant d'appliquer 0029 et 0035

1. **L'offre Supabase Pro sur spotto-prod** (sauvegardes quotidiennes), comme décidé dans la feuille de route : aucun nouveau SQL en production avant. Exceptions décidées par le fondateur le 9 novembre 2026, sans Pro : 0031 (trois colonnes vides), puis 0030, 0032, 0033 et 0034 ensemble (fichier groupé `supabase/mise-en-ligne/social-production.sql`, vérifié deux fois sur spotto-dev-2). Que faire si ça tourne mal : [RESTAURATION.md](RESTAURATION.md).
2. Chacune a d'abord été appliquée sur **spotto-dev-2** (`pnpm --filter backend migrer-dev …`, sur votre Mac), puis vérifiée.
3. Le serveur fonctionne avec ou sans elles : sans 0029, il garde ses compteurs de l'IA en mémoire ; sans 0030, il ne masque rien automatiquement ; sans 0031, il cherche les autres boutiques avant de répondre, comme avant (la nouvelle app attend alors le même temps qu'aujourd'hui) ; sans 0032, les messages sont « indisponibles » et l'app cache l'entrée Messages. Sans 0033, les collections sont « indisponibles » et l'app les cache. Sans 0034, les collections fonctionnent comme avant, mais « Signaler » n'est pas proposé pour une collection. Sans 0035, aucune notification sur le téléphone, même avec `PUSH_ENABLED=true` : l'app ne les propose pas. Sans 0036, aucune alerte prix ni stock n'est enregistrée ni envoyée : l'app cache la cloche, l'interrupteur et « Plus disponible ». Avec 0036 mais sans 0040, ou avec 0040 sans 0041, c'est pareil (les alertes restent coupées tant que leur nouvelle version manque ; le journal du serveur le dit), seuls les réglages « messages / alertes » de chaque appareil (colonnes de 0036) restent utilisés, et les données déjà là restent dans l'export. Sans 0037, l'administrateur ne voit pas « Retirer la bio » ni « Retirer la photo de profil » ; la bio et la photo d'un compte suspendu sont cachées aux autres membres dans tous les cas (aucune migration pour cela). Sans 0038 ou 0039, la mémoire des vidéos est simplement « indisponible » : l'écran « vidéo partagée » fonctionne, sans « Pièces déjà repérées » (sonde du schéma, lib/videoMemory.ts). Sans 0042, l'essayage virtuel reste éteint, même avec `TRYON_ENABLED=true` (drapeau introuvable : éteint) ; avec 0042, il le reste tant que le drapeau `tryon` n'est pas allumé par `pnpm tryon:flag --on --confirm`. Sans 0043, personne ne voit « Vu » ni « Envoyé » sous ses messages, et l'app ne propose pas le réglage « Confirmations de lecture » : personne n'est exposé avant de pouvoir refuser. Sans 0044, la messagerie fonctionne comme avant, et l'app ne propose ni « Aimer », ni « Répondre », ni « Supprimer », ni l'envoi d'une publication dans un message. Un serveur plus ancien fonctionne aussi sur une base qui les a (pour 0034 : il ne tient pas compte des collections masquées par la modération ; à éviter une fois des collections modérées). **Exception, 0043 : jamais sur spotto-prod avant le serveur, l'app (site) et la politique qui portent « Vu ».** La date à partir de laquelle les lectures d'un membre peuvent être montrées est le moment où 0043 est appliquée : appliquée avant, ce qui serait lu entre-temps (serveur plus ancien) serait montré ensuite. Si c'est arrivé : la marche à suivre est en tête du fichier de la migration (« ORDRE DE MISE EN LIGNE »).
4. Toutes sont rejouables : relancer le fichier une seconde fois ne change rien.

Une fois appliquée, changez sa ligne : « appliquée en production », avec la date.
