# Protection anti-robots (Cloudflare Turnstile)

Point 17 de la feuille de route V1. Quelques faux comptes créés par des robots
suffiraient à épuiser le plafond de recherches du jour, puis du mois. La
protection demande à chaque personne une vérification Cloudflare (le plus
souvent invisible : une case cochée toute seule) avant quatre actions :
**connexion**, **inscription**, **« mot de passe oublié »** et **renvoi de
l'e-mail de confirmation**. C'est Supabase qui contrôle la réponse.

Cloudflare Turnstile est **gratuit**. Le code est prêt, mais rien ne change
tant que la clé publique n'est pas saisie : sans elle, l'app et le site
fonctionnent exactement comme avant.

Temps total pour vous : environ 30 minutes, en trois fois (Cloudflare et
Render maintenant ; Expo avant le premier build publié ; Supabase en dernier,
au signal de Claude).

⚠️ Les noms exacts des menus ci-dessous sont à vérifier dans la
documentation officielle (Cloudflare : « Turnstile — Get started » ;
Supabase : « Enable CAPTCHA Protection », supabase.com/docs/guides/auth/auth-captcha).

## 1. Créer le widget dans Cloudflare (10 min)

1. Créez un compte gratuit sur cloudflare.com (aucun nom de domaine à
   transférer), puis ouvrez le tableau de bord.
2. Menu **Turnstile** → **Add widget**.
3. **Widget name** : `Spotto`.
4. **Hostname** : `mon-app-shopping-ia-web.onrender.com` (l'adresse du site,
   sans `https://`). Le jour où le site aura son nom de domaine, ajoutez-le
   ici aussi. Rien à ajouter pour l'iPhone : l'app affiche la page du site.
5. **Widget mode** : **Managed** (recommandé). Pas de « pre-clearance ».
6. Validez. Cloudflare affiche deux clés :
   - la **Site Key** : la clé **publique**, elle va dans Render et chez Expo ;
   - la **Secret Key** : la clé **secrète**, elle va **uniquement dans
     Supabase** (étape 4). Jamais dans le code, l'app, Render, Expo, un
     e-mail ni une conversation.

## 2. Le site (Render, 10 min)

1. **D'abord les en-têtes de sécurité.** Si vous avez déjà collé les
   en-têtes de `EN-TETES-SITE.md` dans Render, remplacez les valeurs de
   `Content-Security-Policy` et de `X-Frame-Options` par celles du tableau
   actuel de cette page (elles autorisent le widget de Cloudflare). Sinon,
   rien à faire ici.
2. Render → le **site** `mon-app-shopping-ia-web` (pas le serveur) →
   **Environment** → **Add Environment Variable** :
   `EXPO_PUBLIC_TURNSTILE_SITE_KEY` = la **Site Key**.
3. Enregistrez, puis remettez le site en ligne (**Manual Deploy** →
   **Deploy latest commit**) : la clé est lue au moment de la construction
   du site.
4. Vérifiez : sur la page de connexion du site, la case de Cloudflare
   apparaît au-dessus du bouton, puis « Réussi ». Dites-le à Claude.

## 3. L'app iPhone (Expo, 5 min, avant le premier build publié)

expo.dev → projet Spotto → **Environment variables** → **Add variable** :
`EXPO_PUBLIC_TURNSTILE_SITE_KEY` = la même **Site Key**, visibilité
**Plain text**, environnements **preview** et **production**
(voir `BUILD-IPHONE.md`, section 2). Le build suivant la porte.

L'iPhone affiche la page `/verification-robot.html` **du site** : le site doit
donc avoir été remis en ligne avec ce lot avant d'essayer sur l'iPhone. Le
contrôle de début de build prévient si la clé manque, et arrête le build si
la clé secrète a été collée à la place de la clé publique.

## 4. La clé secrète, uniquement dans Supabase (5 min, en DERNIER)

Supabase → projet **spotto-prod** → **Authentication** → protection contre
les abus (**Attack Protection** / « Bot and Abuse Protection ») → activer
**Captcha protection** → fournisseur **Turnstile by Cloudflare** → coller la
**Secret Key** → enregistrer.

### La règle, noir sur blanc

**N'activez cette protection dans Supabase qu'une fois :**

- le site remis en ligne **avec** la clé (étape 2), et la case visible ;
- **tous les iPhone en circulation** équipés : chaque build installé, y
  compris dans TestFlight, doit porter la clé (étape 3). Aucun build n'est
  encore publié : **le premier build publié doit donc la porter**.

Pourquoi : dès l'activation, une version de l'app sans la clé ne peut plus ni
se connecter, ni créer de compte, ni demander un nouveau mot de passe, ni
renvoyer l'e-mail. Et rien ne permet aujourd'hui d'imposer une mise à jour
aux iPhone déjà installés (point 11). Prévenez Claude avant d'activer : il
vérifie le site et le build.

**Gardez la confirmation d'e-mail** activée (Supabase → Authentication →
Sign In / Providers → Email → « Confirm email ») : la vérification
anti-robots ne la remplace pas.

## En cas de souci

- Désactiver la protection dans Supabase remet tout comme avant, aussitôt :
  les vérifications envoyées par l'app sont alors simplement ignorées.
- Retirer `EXPO_PUBLIC_TURNSTILE_SITE_KEY` de Render puis remettre le site en
  ligne retire la case du site (à ne faire que si la protection est coupée
  dans Supabase).

## Essais sur le Mac

Cloudflare fournit une clé publique de test, toujours acceptée :
`1x00000000000000000000AA` (dans `apps/mobile/.env`). Sa clé secrète de test
ne se met que dans un projet Supabase d'essai, jamais dans spotto-prod. Avec
la vraie clé, ajoutez `localhost` aux « Hostnames » du widget.

## Pour Claude : ce que fait le code

- `public/verification-robot.html` et `.js` : la seule page hôte du widget,
  statique, copiée telle quelle dans le site exporté. Clé publique et langue
  dans l'adresse ; jeton renvoyé à l'app (`window.ReactNativeWebView`) ou à
  la page parente de même origine (`postMessage` vers `location.origin`).
- `src/lib/robot-check.ts` (logique pure, `tests/robot-check.test.ts`) et
  `src/components/robot-check*.tsx` : iframe sur le site (messages acceptés
  seulement de cette iframe et de l'origine du site), vue web sur iPhone
  (seules la page hôte et `https://challenges.cloudflare.com` dans son cadre
  peuvent se charger ; messages acceptés seulement de la page hôte). Jeton à
  usage unique : pris au moment de l'appel, puis nouveau widget ; nouveau
  widget aussi à l'expiration.
- Les quatre appels : `src/app/sign-in.tsx`, `src/app/sign-up.tsx`,
  `src/app/mot-de-passe-oublie.tsx`, `src/lib/use-resend-confirmation.ts`.
- Les autres appels d'authentification n'en ont pas besoin : `updateUser`
  (nouveau mot de passe, session ouverte) et `exchangeCodeForSession` (lien
  des e-mails) n'acceptent aucun jeton ; `verifyOtp` n'est pas utilisé (et
  son `captchaToken` est déprécié). Si un jour l'app ajoute
  `signInWithIdToken` (Apple), `signInWithOtp` ou `signInAnonymously`, ils
  devront aussi joindre le jeton (`options.captchaToken`).
- En-têtes du site : `web-headers.ts` / `EN-TETES-SITE.md`.
