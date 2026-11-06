# Classement par âge, pays, statut professionnel : les réponses proposées

*Chantier 8, point 8 de la feuille de route V1. Pour le fondateur. Aucune question juridique ici : des faits tirés du code, et des cases à cocher. Ce qui est à vous est marqué 🙋.*

Source des définitions d'Apple (lue le 6 novembre 2026) : https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/. Apple classe désormais en **4+, 9+, 13+, 16+ et 18+**. Le classement final est le plus élevé qu'entraîne l'une des réponses.

**Où** : App Store Connect → Spotto → onglet **Distribution** → **Informations sur l'app** → **Classification par âge** → **Modifier**.

---

## 1. Le questionnaire, réponse par réponse

### Contrôles dans l'app (*In-App Controls*)

| Question | Réponse proposée | Pourquoi (d'après le code) |
|---|---|---|
| Contrôle parental | **Non** | Aucun réglage pour les parents dans l'app. |
| Vérification de l'âge (*Age Assurance*) | **Non** | L'app demande seulement de certifier « au moins 15 ans » d'une case, sans vérification (`apps/mobile/src/app/sign-up.tsx:56`, politique `apps/mobile/src/legal/confidentialite.ts:161`). Apple vise un vrai contrôle (pièce d'identité, estimation, API d'Apple) : Spotto n'en a pas. |

### Fonctions (*Capabilities*)

| Question | Réponse proposée | Effet sur l'âge | Pourquoi (d'après le code) |
|---|---|---|---|
| Contenu créé par les utilisateurs | **Oui** | 4+ | Publications, commentaires, profils (`apps/backend/src/routes/posts.ts:442`, `apps/backend/src/routes/comments.ts:106`). |
| Réseau social (*Social Media*) | **Oui** | **13+** | Apple : « un fil ou une découverte qui diffuse le contenu des utilisateurs à beaucoup de monde, avec des j'aime, des commentaires, des partages ». C'est le fil de Spotto (`posts.ts:366`, j'aime `:731`). |
| Réseau social coupé avant 13 ans | **Non** | — | Il faudrait appeler l'API d'âge d'Apple (*Declared Age Range*) : rien de tel dans le code. |
| Messagerie et discussion | 🙋 à cocher ci-dessous | 4+ dans les deux cas | Pas de messages libres. Mais on peut « envoyer » une pièce de ses Envies à quelqu'un (photo, titre, lien ; aucun texte tapé : `apps/backend/supabase/migrations/0024_partage_envies.sql:57-72`). |
| Publicité | **Non** | — | Aucune publicité dans l'app. |
| Accès libre au web (*Unrestricted Web Access*) | 🙋 à cocher ci-dessous | **16+** si « Oui » | Apple : « on peut aller sur n'importe quelle page dans l'app, ou naviguer librement ». Chez Spotto, « Voir chez… » ouvre **la page du marchand** dans une fenêtre Safari intégrée (`apps/mobile/src/lib/merchant-links.ts:90-93`, `WebBrowser.openBrowserAsync`). On peut y suivre les liens du site ; on ne peut pas taper une autre adresse (à vérifier sur l'iPhone). |

🙋 **Messagerie et discussion**
- [ ] **Non** (conseillé) : l'envoi d'une pièce n'est pas une discussion.
- [ ] **Oui**, par prudence : sans effet sur l'âge (4+).

🙋 **Accès libre au web**
- [ ] **Non** (conseillé) : l'app n'ouvre que des pages de marchands précises, sans barre d'adresse à taper. Classement : **13+**.
- [ ] **Oui** : classement **16+**, plus proche des 15 ans demandés par l'app.

### Thèmes pour adultes, santé, sexualité, violence, hasard

| Question | Réponse proposée | Pourquoi |
|---|---|---|
| Grossièretés ou humour cru | **Aucun** | Un filtre refuse les mots injurieux (`apps/backend/src/lib/contentFilter.ts`, appliqué par `comments.ts:120`, `posts.ts:483`, `apps/backend/src/routes/me.ts:185`). Le contenu des utilisateurs est déjà couvert par la question « Contenu créé par les utilisateurs ». |
| Horreur, peur | **Aucun** | — |
| Alcool, tabac, drogues | **Aucun** | — |
| Santé, bien-être ; informations médicales | **Aucun** | — |
| Thèmes suggestifs (*Mature or Suggestive Themes*) | 🙋 à cocher ci-dessous | Les résultats d'une recherche de mode peuvent montrer des maillots de bain ou de la lingerie, venus des marchands. |
| Contenu sexuel, nudité | **Aucun** | — |
| Violence (dessin animé, réaliste, prolongée) ; armes | **Aucun** | — |
| Concours, jeux d'argent simulés ou réels, coffres à butin | **Aucun** | — |

🙋 **Thèmes suggestifs**
- [ ] **Aucun**.
- [ ] **Rares** (*Infrequent*), par prudence : 9+, donc sans effet sur le classement final (13+ au moins, à cause du réseau social).

### Le classement obtenu

- Avec les réponses conseillées : **13+**.
- Avec « Accès libre au web : Oui » : **16+**.
- **Australie** : un réseau social y est classé **16+** quoi qu'il arrive (règle propre à ce pays, sur la même page d'Apple).

🙋 **L'âge de l'app et celui d'Apple.** L'app demande 15 ans (`packages/shared-types/src/index.ts:775`) ; Apple n'a pas de « 15+ ».
- [ ] Garder le classement calculé (13+), l'app demandant de toute façon 15 ans à l'inscription.
- [ ] Viser 16+ : soit par « Accès libre au web : Oui », soit par un réglage d'App Store Connect qui permettrait de choisir un âge plus élevé que celui calculé (à vérifier à l'écran : je ne l'ai pas trouvé sur la page d'Apple).

**Bon à savoir** : les captures d'écran et l'icône doivent convenir à un public de 4 ans, quel que soit le classement (règle 2.3.8). Voir [CAPTURES.md](CAPTURES.md).

---

## 2. Les pays

**Où** : App Store Connect → Spotto → **Prix et disponibilité** → **Disponibilité de l'app**.

Les faits utiles :
- L'app existe en **français** et en **anglais** seulement (`apps/mobile/app.json:25-28`).
- En français, les recherches visent la **France** ; en anglais, la région réglée sur l'iPhone, à défaut les **États-Unis** (`apps/backend/src/lib/locale.ts:24-28`).
- La feuille de route conseille la France et l'Union européenne pour la V1 (point 8), et signale, pour les États-Unis, une loi du Texas sur l'âge (à vérifier).
- Pour distribuer dans l'**Union européenne**, Apple exige d'abord la déclaration du statut professionnel (partie 3).

🙋 **Choisir une case :**
- [ ] **France seule.**
- [ ] **Les 27 pays de l'Union européenne** (conseillé par la feuille de route pour la V1).
- [ ] L'Union européenne, plus la Suisse, la Norvège, l'Islande, le Royaume-Uni.
- [ ] Le monde entier.

Et la case d'App Store Connect « rendre l'app disponible dans les nouveaux pays ajoutés par Apple » : 🙋 [ ] oui [ ] non (je conseille non pour la V1).

---

## 3. Le statut professionnel (règlement européen sur les services numériques, DSA)

**Où** : App Store Connect → **Business** (ou **Accords, taxes et banques**) → **Conformité** → **Digital Services Act** (à vérifier : l'emplacement exact change).

Les faits :
- Apple demande à chaque développeur qui distribue dans l'Union européenne de dire s'il est un **professionnel** (*trader*) ou non. Sans réponse, l'app n'est pas proposée dans les pays de l'Union (à vérifier à l'écran).
- Si vous déclarez être un professionnel, Apple demande une adresse, un téléphone et un e-mail, les vérifie, et les **affiche sur la fiche** de l'app dans l'Union européenne (à vérifier : quels champs exactement).
- Ces coordonnées devraient être celles de l'éditeur, les mêmes que dans les pages légales (`EXPO_PUBLIC_PUBLISHER_*`, saisies chez Expo et chez Render ; jamais dans ce dépôt public).

🙋 **Choisir une case :**
- [ ] Je déclare être un **professionnel** (*trader*).
- [ ] Je déclare **ne pas** être un professionnel.

---

## 4. Les droits sur le contenu

**Où** : App Store Connect → **Informations sur l'app** → **Droits relatifs au contenu**.

- « Votre app contient-elle, affiche-t-elle ou donne-t-elle accès à du contenu de tiers ? » → **Oui**, c'est un fait : images des marchands et de Google dans les résultats (politique `apps/mobile/src/legal/confidentialite.ts:98`), publications des utilisateurs.
- La case suivante (« disposez-vous des droits nécessaires… ») : 🙋 à vous.

---

## 5. Rappel : le compte Apple Developer

Le nom du vendeur affiché sur l'App Store vient du compte : votre nom (compte de particulier) ou celui de la société (compte d'organisation, avec un numéro D-U-N-S). Voir la feuille de route, partie 7, étape 7. 🙋
