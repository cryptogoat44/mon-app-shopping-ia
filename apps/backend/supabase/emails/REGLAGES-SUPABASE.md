# E-mails de connexion de Spotto : les réglages Supabase

*Chantier 3 (comptes et modération), points 3 et 13 de la feuille de route V1. À faire par le fondateur, sur **spotto-prod** (et, pour essayer d'abord, sur spotto-dev-2). Environ 30 minutes, hors choix du service d'envoi.*

Les trois modèles de ce dossier sont **bilingues** : chaque e-mail part en anglais si le compte a été créé en anglais, en français sinon (l'app enregistre la langue de la personne à l'inscription). Ils ont été vérifiés avec le moteur de modèles de Go, celui de Supabase : français, anglais, et compte sans langue enregistrée (français).

## 1. Coller les modèles

Supabase → projet **spotto-prod** → **Authentication** → **Emails** → onglet **Templates**. Pour chaque modèle : remplir le **Subject** (sujet), coller le contenu du fichier dans **Message body** (onglet *Source*), puis **Save**.

| Modèle Supabase | Fichier à coller | Sujet à coller |
|---|---|---|
| **Confirm signup** (inscription, et « Renvoyer l'e-mail ») | `confirmation-inscription.html` | `{{ if eq .Data.locale "en" }}Confirm your Spotto account{{ else }}Confirmez votre compte Spotto{{ end }}` |
| **Reset Password** (mot de passe oublié) | `mot-de-passe-oublie.html` | `{{ if eq .Data.locale "en" }}Reset your Spotto password{{ else }}Réinitialisez votre mot de passe Spotto{{ end }}` |
| **Change Email Address** (changement d'adresse) | `changement-adresse.html` | `{{ if eq .Data.locale "en" }}Confirm your new email address{{ else }}Confirmez votre nouvelle adresse e-mail{{ end }}` |

- Si Supabase refuse un sujet avec `{{ … }}`, mettre un sujet simple dans les deux langues, par exemple : `Spotto — Confirmez votre compte / Confirm your account`.
- **Magic Link**, **Invite user** et **Reauthentication** : à laisser tels quels, Spotto ne s'en sert pas.
- Ne rien changer d'autre dans les modèles : le bouton utilise `{{ .ConfirmationURL }}`, qui marche avec le nouveau flux de l'app (PKCE, voir le point 4).

## 2. Le service d'envoi (le plus urgent)

**Authentication** → **Emails** → onglet **SMTP Settings**.

- **Enable custom SMTP** doit être activé, avec un service d'envoi (Brevo, Resend, Postmark, SendGrid…). Sans lui, Supabase n'envoie qu'environ 2 e-mails par heure, et seulement aux membres de l'équipe du projet : « mot de passe oublié » ne marche pour personne d'autre.
- **Sender email** : idéalement une adresse sur votre propre nom de domaine (une adresse Gmail envoyée par un service tiers finit souvent en courrier indésirable). **Sender name** : `Spotto`.
- Si c'est l'essai SendGrid du 9 septembre, il s'arrête le **8 novembre** : à remplacer avant.

## 3. Les réglages à contrôler

| Où | Réglage | Valeur |
|---|---|---|
| Authentication → **Sign In / Providers** → Email | **Enable Email provider** | activé |
| idem | **Confirm email** | activé (recommandé : l'app gère les deux cas) |
| idem | **Secure email change** | activé |
| idem | **Minimum password length** | 8 (comme l'app) |
| idem | **Email OTP Expiration** | 3600 secondes : les e-mails et l'app annoncent « valable une heure » |
| Authentication → **Sign In / Providers** (haut de page) | **Allow new users to sign up** | activé |
| Authentication → **URL Configuration** | **Site URL** | l'adresse du site Spotto (celle que vous ouvrez dans le navigateur, sans `/` à la fin) : c'est là que mènent les liens de confirmation |
| idem | **Redirect URLs** | ajouter **`https://<adresse du site>/nouveau-mot-de-passe`** et **`spotto://nouveau-mot-de-passe`** (l'app iPhone). Sans la seconde, « mot de passe oublié » sur iPhone ramène sur le site |
| Authentication → **Rate Limits** | **Rate limit for sending emails** | au moins 30 par heure (100 pour le lancement) ; ne s'applique qu'avec le service d'envoi |

## 4. Ce qui a changé dans l'app (rien à régler de plus)

- **Flux PKCE** (point 13) : le lien des e-mails ne contient plus la session de la personne, seulement un code à usage unique, que seul l'appareil qui a fait la demande peut échanger. Sur iPhone, une autre app qui intercepterait le lien `spotto://` d'une demande faite dans Spotto n'en ferait rien. Limite : quelqu'un peut encore lancer lui-même une réinitialisation sans ce code vers `spotto://` (Supabase ne peut pas l'interdire) ; la fermer tout à fait demandera des liens universels https pour l'iPhone (point 27 de la feuille de route). Conséquence à connaître : le lien « mot de passe oublié » doit être ouvert **sur l'appareil où la demande a été faite** (même téléphone, ou même navigateur) ; ailleurs, l'app l'explique et propose de refaire la demande.
- Les liens déjà envoyés avant la mise en ligne restent lus (ancien format).
- Confirmation d'inscription ouverte sur le site, dans le navigateur de l'inscription : la session s'ouvre directement. Ailleurs (inscription faite sur l'iPhone, par exemple) : l'adresse est confirmée, le site invite à se connecter.

## 5. L'essai, une fois tout réglé (10 minutes)

1. Avec une adresse **extérieure** à l'équipe (par exemple une adresse personnelle jamais utilisée sur Spotto) : créer un compte en français sur le site. L'e-mail arrive-t-il, en français, hors des indésirables ? Le lien active-t-il le compte ?
2. Même chose avec l'app réglée en anglais : l'e-mail doit être en anglais.
3. « Mot de passe oublié » sur le site, lien ouvert dans le même navigateur : le formulaire du nouveau mot de passe s'affiche.
4. « Mot de passe oublié » sur l'iPhone (quand le build existe), lien ouvert sur l'iPhone : l'app s'ouvre sur le formulaire.
