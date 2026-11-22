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
| `plafond_recherches` | plafond du jour ou du mois atteint : Spotter fermé à tous (`plafond` = `day` ou `month`) ; ou, abonnements allumés, les comptes gratuits arrêtés par la réserve des abonnés, 70 % du plafond atteints (`plafond` = `reserve_day` ou `reserve_month` : seuls les abonnés cherchent encore ; réglage `SUBSCRIBER_RESERVE_PERCENT`) | une par jour (le jour), une par cycle (le mois), pour chacune |
| `seuil_recherches` | avertissement, avant la fermeture : le compteur du mois atteint 80 % du plafond (180 sur 225, `plafond` = `month`) ou celui du jour (20 sur 25, `plafond` = `day`) ; Spotter reste ouvert, rien n'est refusé. Seuil réglable par `SERPAPI_WARN_PERCENT` (entier de 50 à 99 ; une valeur invalide est ignorée, 80 retenu, avec un avertissement dans le journal). Mesuré sur les plafonds totaux, sans la réserve des abonnés | une par cycle (le mois), une par jour (le jour) |
| `plafond_ia` | 300 analyses de l'IA dans la journée | une par jour |
| `echecs_repetes` | 5 échecs en 15 minutes de l'IA (vidéo, voie C), de Google Shopping ou du service vidéo (`source` = `service_video` : service injoignable ou trop lent, bloqué par TikTok ou Instagram, secret différent des deux côtés ; pour couper l'analyse des liens : `VIDEO_LINK_ANALYSIS_ENABLED`) | une par heure au plus |
| `signalement` | un nouveau signalement attend la modération | une par contenu signalé (les signalements suivants du même contenu se regroupent) |
| `masquage_auto` | un contenu signalé par 3 personnes différentes vient d'être masqué | une par contenu |

Une même alerte n'est pas répétée (mémoire du serveur). Après un redémarrage
(mise en veille de l'offre gratuite de Render, déploiement), elle peut
réapparaître dans le journal, une fois par redémarrage ; dans Sentry, elle
rejoint le même problème (même empreinte) : la règle « nouveau problème » ne
vous prévient qu'une fois par jour ou par cycle (tant que vous ne marquez pas
ce problème comme résolu).

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

## Comment elles vous arrivent aujourd'hui

- **Toujours** : une ligne `Alerte` dans le journal de Render (service
  `spotto-api`, onglet **Logs**). Personne n'est prévenu : il faut aller lire.
- **Sur votre téléphone ou par e-mail** : seulement si `SENTRY_DSN` est rempli
  sur Render **et** si la règle ci-dessous existe dans Sentry. C'est Sentry qui
  envoie l'e-mail ou la notification ; le serveur n'envoie aucun e-mail
  lui-même (aucun service d'e-mail n'est branché).

## À régler dans Sentry (une fois)

1. Sur Render, service `spotto-api`, vérifier que `SENTRY_ENVIRONMENT` vaut
   `production`.
2. Dans Sentry : **Alerts** → **Create Alert** → **Issues** →
   « A new issue is created », filtre « The event's tags match `alerte` is set »,
   action : vous prévenir par e-mail **et** sur l'application Sentry du téléphone.
3. Installer l'application Sentry sur le téléphone et s'y connecter.

## La sonde extérieure

`https://spotto-api.onrender.com/health/deep` répond 200 quand le serveur et la
base répondent, 503 sinon. `/health` (sans la base) reste celle de Render.

Ne pas la faire interroger automatiquement toutes les quelques minutes tant
que le service est sur l'offre gratuite de Render : garder éveillé un service
gratuit par des appels automatiques y est considéré comme un abus. Ouvrez-la
à la main quand vous voulez vérifier (le premier appel peut prendre une
minute si le service dormait), ou, au plus, faites-la interroger rarement
(une ou deux fois par jour). Une surveillance fréquente (Sentry « Uptime »,
UptimeRobot) n'a sa place qu'avec une offre payante de Render.
