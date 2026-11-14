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
| 0030 | Masquage automatique après 3 signalements | appliquée en production (fichier groupé `social-production.sql`, sans Supabase Pro : décision du fondateur) | 9 nov. 2026 |
| 0031 | Boutiques ensuite : résultats Lens tout de suite, autres boutiques juste après | appliquée en production (sans Supabase Pro : décision du fondateur, 3 colonnes vides ajoutées) | 9 nov. 2026 |
| 0032 | Messages privés entre membres (conversations, invitations, envie jointe) | appliquée en production (fichier groupé `social-production.sql`, sans Supabase Pro : décision du fondateur) | 9 nov. 2026 |
| 0033 | Collections d'envies, privées ou montrées aux amis | appliquée en production (fichier groupé `social-production.sql`, sans Supabase Pro : décision du fondateur) | 9 nov. 2026 |
| 0034 | Modération des collections : les signaler, les masquer, retirer une image copiée | appliquée en production (fichier groupé `social-production.sql`, sans Supabase Pro : décision du fondateur) | 9 nov. 2026 |
| 0035 | Notifications des nouveaux messages sur le téléphone : les appareils prévenus | **à appliquer** (ne sert qu'avec 0032) | — |
| 0036 | Alertes prix et stock : suivi des envies, cloches, alertes, « Plus disponible » | **à appliquer** (sur spotto-dev-2 seulement pour l'instant ; demande 0035) | — |
| 0037 | Modération des profils : un administrateur peut retirer une bio ou une photo de profil | **à appliquer** (sur spotto-dev-2 d'abord ; demande 0026, déjà en production) | — |
| 0042 | Essayage virtuel photo, ÉTEINT : drapeau des fonctions, statut d'âge et consentement, essais (sans aucune image), essais offerts, signalements, alertes et compteurs du budget | **à appliquer** (sur spotto-dev-2 seulement ; l'essayage reste éteint) | — |

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
| 0042 | le fichier de la migration lui-même | `supabase/verifications/0042-verification.sql` (une ligne, huit `true`) | en tête du fichier de la migration |

## Avant d'appliquer 0029 et 0035

1. **L'offre Supabase Pro sur spotto-prod** (sauvegardes quotidiennes), comme décidé dans la feuille de route : aucun nouveau SQL en production avant. Exceptions décidées par le fondateur le 9 novembre 2026, sans Pro : 0031 (trois colonnes vides), puis 0030, 0032, 0033 et 0034 ensemble (fichier groupé `supabase/mise-en-ligne/social-production.sql`, vérifié deux fois sur spotto-dev-2). Que faire si ça tourne mal : [RESTAURATION.md](RESTAURATION.md).
2. Chacune a d'abord été appliquée sur **spotto-dev-2** (`pnpm --filter backend migrer-dev …`, sur votre Mac), puis vérifiée.
3. Le serveur fonctionne avec ou sans elles : sans 0029, il garde ses compteurs de l'IA en mémoire ; sans 0030, il ne masque rien automatiquement ; sans 0031, il cherche les autres boutiques avant de répondre, comme avant (la nouvelle app attend alors le même temps qu'aujourd'hui) ; sans 0032, les messages sont « indisponibles » et l'app cache l'entrée Messages. Sans 0033, les collections sont « indisponibles » et l'app les cache. Sans 0034, les collections fonctionnent comme avant, mais « Signaler » n'est pas proposé pour une collection. Sans 0035, aucune notification sur le téléphone, même avec `PUSH_ENABLED=true` : l'app ne les propose pas. Sans 0036, aucune alerte prix ni stock n'est enregistrée ni envoyée : l'app cache la cloche, l'interrupteur et « Plus disponible ». Sans 0037, l'administrateur ne voit pas « Retirer la bio » ni « Retirer la photo de profil » ; la bio et la photo d'un compte suspendu sont cachées aux autres membres dans tous les cas (aucune migration pour cela). Sans 0042, l'essayage virtuel reste éteint, même avec `TRYON_ENABLED=true` (drapeau introuvable : éteint) ; avec 0042, il le reste tant que le drapeau `tryon` n'est pas allumé par `pnpm tryon:flag --on --confirm`. Un serveur plus ancien fonctionne aussi sur une base qui les a (pour 0034 : il ne tient pas compte des collections masquées par la modération ; à éviter une fois des collections modérées).
4. Toutes sont rejouables : relancer le fichier une seconde fois ne change rien.

Une fois appliquée, changez sa ligne : « appliquée en production », avec la date.
