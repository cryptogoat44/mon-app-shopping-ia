# Être prévenu quand quelque chose casse

Lot garde-fous (points 6 et 15 de la feuille de route V1). Le code envoie les
alertes ; **où les recevoir se règle chez Sentry et chez un service de
surveillance**, par le fondateur.

## Ce que le serveur envoie

Chaque alerte écrit une ligne `Alerte` dans le journal de Render et, si
`SENTRY_DSN` est réglé, un avertissement à Sentry avec le tag `alerte` :

| Tag `alerte` | Quand | Combien de fois |
| --- | --- | --- |
| `disjoncteur` | la recherche par image se met en pause (6 recherches mauvaises sur les 10 dernières) | une par heure au plus |
| `plafond_recherches` | plafond du jour ou du mois atteint : Spotter fermé à tous | une par jour (le jour), une par cycle (le mois) |
| `plafond_ia` | 300 analyses de l'IA dans la journée | une par jour |
| `echecs_repetes` | 5 échecs en 15 minutes de l'IA (vidéo, voie C) ou de Google Shopping | une par heure au plus |
| `signalement` | un nouveau signalement attend la modération | une par contenu signalé (les signalements suivants du même contenu se regroupent) |
| `masquage_auto` | un contenu signalé par 3 personnes différentes vient d'être masqué | une par contenu |

Jamais de compte, d'adresse ni de contenu : le type, et des valeurs comme
« post » ou « spam ». Rien sur la personne qui signale. Les deux dernières
lignes portent aussi le tag `moderation` (chantier 3) : une règle déjà créée
sur ce tag continue de marcher.

## Essayage virtuel (éteint par défaut)

Ses alertes ne partent ni à Sentry ni par e-mail (aucun service d'e-mail n'est
branché) : chacune est enregistrée **une seule fois par période** dans la table
`tryon_alerts` de la base, et écrit une ligne d'avertissement
`Alerte de l'essayage virtuel` dans le journal de Render :

| Champ `alerte` | Quand | Combien de fois |
| --- | --- | --- |
| `essayage_budget_80` | la dépense FASHN du mois atteint 80 % du budget (`TRYON_ALERT_THRESHOLD`) | une par mois |
| `essayage_budget_100` | le budget du mois ne permet plus un essai de plus : les essais sont refusés jusqu'au mois suivant | une par mois |
| `essayage_low_credits` | le solde de crédits FASHN est sous `TRYON_MIN_FASHN_CREDITS` (ou épuisé) : les essais sont refusés | une par jour |

`pnpm --filter backend tryon:report` les liste avec la dépense du mois. Le jour
où un e-mail est branché, il part d'un seul endroit : `notifyTryonAlert`
(`src/lib/tryon/alerts.ts`).

## À régler dans Sentry (une fois)

1. Sur Render, service `spotto-api`, vérifier que `SENTRY_ENVIRONMENT` vaut
   `production`.
2. Dans Sentry : **Alerts** → **Create Alert** → **Issues** →
   « A new issue is created », filtre « The event's tags match `alerte` is set »,
   action : vous prévenir par e-mail **et** sur l'application Sentry du téléphone.
3. Installer l'application Sentry sur le téléphone et s'y connecter.

## La sonde extérieure

`https://spotto-api.onrender.com/health/deep` répond 200 quand le serveur et la
base répondent, 503 sinon. Un service de surveillance (Sentry « Uptime », ou
UptimeRobot, gratuit) l'interroge toutes les 5 minutes et prévient en cas
d'échec. `/health` (sans la base) reste celle de Render.
