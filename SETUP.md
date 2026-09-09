# Mise en route

Ce document explique comment faire tourner le projet en local. Vous n'aurez
à refaire ces étapes qu'une fois (sauf la section "à chaque nouveau bloc" qui
reviendra de temps en temps).

> **Déjà fait pour vous** (session du 2026-09-03) : le projet Supabase
> `mon-app-shopping-ia` est créé (compte `aifans1.0@outlook.fr`, région
> `eu-west-1`), les migrations `0001` à `0006` sont exécutées, un compte
> SerpApi est créé (même compte `aifans1.0@outlook.fr`), et les fichiers
> `.env` sont remplis (Supabase + SerpApi). Les étapes 1 à 3 ci-dessous ne
> sont donc à relire que si vous changez de machine ou perdez ces fichiers.

## 0. Outils déjà installés sur cette machine

Node.js et pnpm ont été installés via Homebrew pendant la session de mise en
place. Pour vérifier qu'ils sont bien disponibles :

```bash
node -v   # doit afficher une version 20+
pnpm -v
```

## 1. Créer le projet Supabase (une seule fois)

1. Allez sur [supabase.com](https://supabase.com) et créez un compte (gratuit pour démarrer).
2. Cliquez sur **New project**. Choisissez un nom (ex. `mon-app-shopping-ia`), une région proche de vos futurs utilisateurs (Europe), et un mot de passe de base de données que vous conservez précieusement (un gestionnaire de mots de passe, pas un fichier texte).
3. Une fois le projet créé (1-2 minutes), allez dans **Project Settings > API Keys**. Notez trois valeurs, vous en aurez besoin juste après :
   - **Project URL** (Project Settings > General > Project ID, sous la forme `https://<project-id>.supabase.co`)
   - **Publishable key**
   - **Secret key** (⚠️ à garder strictement secrète — jamais dans l'app mobile)

## 2. Exécuter le schéma de base de données

1. Dans Supabase, ouvrez **SQL Editor**.
2. Copiez-collez le contenu de `apps/backend/supabase/migrations/0001_init_schema.sql`, exécutez.
3. Copiez-collez ensuite `apps/backend/supabase/migrations/0002_handle_new_user.sql`, exécutez.
4. Vérifiez dans **Table Editor** que les tables (`profiles`, `follows`, `product_searches`, ...) sont bien créées.

Les prochains blocs ajouteront de nouveaux fichiers `000X_....sql` dans ce
même dossier : à chaque fois, même procédure (copier-coller dans SQL Editor,
exécuter, dans l'ordre des numéros).

## 3. Configurer les variables d'environnement

**Backend** — créez `apps/backend/.env` à partir de `apps/backend/.env.example` :

```bash
cp apps/backend/.env.example apps/backend/.env
```

Puis ouvrez `apps/backend/.env` et collez votre `Project URL` et votre
`Secret key` récupérés à l'étape 1.

**Mobile** — créez `apps/mobile/.env` à partir de `apps/mobile/.env.example` :

```bash
cp apps/mobile/.env.example apps/mobile/.env
```

Collez votre `Project URL` et votre `Publishable key`. Pour `EXPO_PUBLIC_API_URL`,
gardez `http://localhost:3000` si vous testez dans le simulateur ou sur le web ;
si vous testez sur un téléphone physique via l'app Expo Go, remplacez
`localhost` par l'adresse IP locale de votre ordinateur (visible dans
Réglages système > Réseau), par exemple `http://192.168.1.24:3000`.

## 4. Lancer le projet

Deux terminaux, à la racine du projet :

```bash
# Terminal 1 — backend
pnpm backend:dev

# Terminal 2 — mobile
pnpm mobile:start
```

Le mobile démarre l'interface Expo : appuyez sur `w` pour ouvrir dans le
navigateur (le plus rapide pour un premier essai), ou scannez le QR code
avec l'app **Expo Go** sur votre téléphone (iOS/Android).

## À chaque nouveau bloc de fonctionnalités

1. `git pull` si vous travaillez sur plusieurs machines (à activer une fois qu'on aura un dépôt distant).
2. `pnpm install` si de nouvelles dépendances ont été ajoutées.
3. Exécuter les nouvelles migrations SQL listées dans `apps/backend/supabase/migrations/` (celles que vous n'avez pas encore passées).
4. Relancer `pnpm backend:dev` et `pnpm mobile:start`.

## Version en ligne (déployée sur Render, session du 2026-09-09)

L'app tourne aussi en ligne, accessible depuis n'importe quel ordinateur ou
téléphone, sans rien installer :

- **App (version web)** : https://mon-app-shopping-ia-web.onrender.com
- **Backend** : https://mon-app-shopping-ia.onrender.com (pas besoin d'y aller directement, c'est l'app qui l'appelle)
- **Code source** : https://github.com/cryptogoat44/mon-app-shopping-ia (dépôt public)
- **Tableau de bord Render** : https://dashboard.render.com (compte créé avec votre GitHub)

Ces deux services sont sur le plan gratuit de Render : le backend
"s'endort" après un moment sans trafic, donc la première requête après une
pause peut prendre jusqu'à 50 secondes avant de répondre — c'est normal, pas
un bug. Suffisant pour tester, pas pour de vrais utilisateurs (à revoir le
jour où on passe en production).

**Pour republier une mise à jour** : chaque fois que du code est poussé sur
la branche `main` du dépôt GitHub, Render reconstruit et republie
automatiquement les deux services — rien à faire manuellement. Si vous
changez une valeur secrète (clé Supabase, clé SerpApi), il faut la mettre à
jour à la main dans Render : ouvrez le service concerné > **Environment**.

## Envoi d'emails (SMTP, session du 2026-09-09)

Par défaut, Supabase n'autorise qu'un tout petit nombre d'emails de
confirmation par heure — suffisant pour un usage ponctuel, pas pour des
tests répétés ni pour de vrais utilisateurs. Un vrai fournisseur d'envoi
d'emails a donc été branché :

- **Compte Gmail dédié à l'app** : `monappshoppingia@gmail.com` (mot de
  passe créé par vous, à noter dans votre gestionnaire de mots de passe si
  pas déjà fait). C'est l'adresse "expéditeur" que verront vos utilisateurs.
- **Compte SendGrid** (fournisseur d'envoi, via Twilio) : même adresse
  `monappshoppingia@gmail.com`, essai gratuit jusqu'au 8 novembre 2026.
  Tableau de bord : https://app.sendgrid.com
- Configuré dans Supabase (**Authentication > Emails > SMTP Settings**) :
  activé, ce qui fait passer la limite de Supabase de quelques emails/heure
  à 30/heure.

**Avant la fin de l'essai gratuit SendGrid (8 novembre 2026)**, il faudra
soit passer sur un plan payant SendGrid (quelques dollars/mois selon le
volume), soit changer de fournisseur — sans quoi les emails de confirmation
s'arrêteront à nouveau. Je peux m'en occuper si vous me le rappelez avant
cette date.
