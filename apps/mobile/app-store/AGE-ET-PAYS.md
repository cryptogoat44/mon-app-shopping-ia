# Classement par âge, pays, statut professionnel : les réponses proposées

*Chantier 8, point 8 de la feuille de route V1. Pour le fondateur. Aucune question juridique ici : des faits tirés du code, et des cases à cocher. Ce qui est à vous est marqué 🙋.*

*Remis à jour le 10 novembre 2026 (lot « conformité Apple ») : **l'app a maintenant des messages privés, avec du texte libre**. La réponse « Messagerie et discussion » n'est plus un choix : c'est **Oui**. Règle 2.3.6 d'Apple : « Answer the age rating questions in App Store Connect honestly so that your app aligns properly with parental controls. » Le choix du classement final (13+ ou 16+) reste le vôtre : les options sont en fin de partie 1.*

Source des définitions d'Apple (lue le 6 novembre 2026 ; l'audit du 10 novembre n'a pas pu la relire, la page téléchargée était « introuvable » : **recoupez les effets sur l'âge à l'écran**) : https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/. Apple classe désormais en **4+, 9+, 13+, 16+ et 18+**. Le classement final est le plus élevé qu'entraîne l'une des réponses.

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
| Contenu créé par les utilisateurs | **Oui** | 4+ | Publications, commentaires, profils (bio, photo), messages privés, noms de collections (`apps/backend/src/routes/posts.ts`, `comments.ts`, `me.ts`, `conversations.ts`, `collections.ts`). |
| Réseau social (*Social Media*) | **Oui** | **13+** | Apple : « un fil ou une découverte qui diffuse le contenu des utilisateurs à beaucoup de monde, avec des j'aime, des commentaires, des partages ». C'est le fil de Spotto (`posts.ts:366`, j'aime `:731`). |
| Réseau social coupé avant 13 ans | **Non** | — | Il faudrait appeler l'API d'âge d'Apple (*Declared Age Range*) : rien de tel dans le code. |
| Messagerie et discussion | **Oui** (ce n'est plus un choix) | 4+ d'après la lecture du 6 novembre (à recouper à l'écran) | **Des messages privés avec du texte libre existent** : jusqu'à 1 000 caractères, plus la « carte » d'une envie ; pas de photo libre (`apps/backend/src/routes/conversations.ts`, `packages/shared-types/src/index.ts` : `MESSAGE_MAX_LENGTH`, table `messages` de la migration 0032). Deux amis s'écrivent directement ; par défaut, **tout membre peut envoyer une invitation à tout autre membre** (réglage « Qui peut m'écrire », défaut « Tout le monde » : `DEFAULT_MESSAGES_FROM`). Garde-fous : une seule invitation, refus discret, blocage, signalement d'un message, filtre de mots, 10 invitations par heure (`apps/backend/src/lib/messaging.ts:1-12`). |
| Publicité | **Non** | — | Aucune publicité dans l'app. |
| Accès libre au web (*Unrestricted Web Access*) | 🙋 à cocher ci-dessous | **16+** si « Oui » | Apple : « on peut aller sur n'importe quelle page dans l'app, ou naviguer librement ». Chez Spotto, « Voir chez… » ouvre **la page du marchand** dans une fenêtre Safari intégrée (`apps/mobile/src/lib/merchant-links.ts:90-93`, `WebBrowser.openBrowserAsync`). On peut y suivre les liens du site ; on ne peut pas taper une autre adresse (à vérifier sur l'iPhone). |

**Messagerie et discussion : Oui.** Répondre « Non » serait faux depuis l'arrivée des messages privés. Si l'écran d'Apple pose des sous-questions (discussion avec des inconnus, contenu filtré ou non, signalement), les faits sont dans la ligne du tableau : une invitation d'un inconnu est possible par défaut ; les textes passent par un filtre de mots ; chaque message reçu se signale.

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

- Avec les réponses conseillées : **13+** (d'après la lecture du 6 novembre, « Messagerie : Oui » ne change pas le calcul ; à recouper à l'écran : si Apple classe plus haut une messagerie ouverte aux inconnus, c'est son calcul qui vaut).
- Avec « Accès libre au web : Oui » : **16+**.
- **Australie** : un réseau social y est classé **16+** quoi qu'il arrive (règle propre à ce pays, sur la même page d'Apple).

🙋 **L'âge de l'app et celui d'Apple : votre choix** (décision D de l'audit). L'app demande 15 ans, par une case à cocher, sans contrôle (`apps/mobile/src/app/sign-up.tsx`) ; Apple n'a pas de « 15+ ». Les options :
- [ ] **13+** : garder le classement calculé. L'app demande de toute façon 15 ans à l'inscription. À savoir : avec ce classement, l'App Store propose l'app à des 13-14 ans que l'inscription refuse ensuite, et à des 15-17 ans qui peuvent, par défaut, recevoir une invitation de n'importe quel membre.
- [ ] **16+** : plus proche des 15 ans demandés, et plus prudent pour une messagerie ouverte par défaut. Deux chemins : « Accès libre au web : Oui », ou un réglage d'App Store Connect qui permettrait de choisir un âge plus élevé que celui calculé (à vérifier à l'écran : je ne l'ai pas trouvé sur la page d'Apple).
- [ ] **13+, avec un réglage « Qui peut m'écrire » plus strict par défaut** (« Comptes que je suis ») : c'est un changement de code, à demander (décision C de l'audit).

Ce choix touche les mineurs de 15 à 17 ans : la règle 5.1.4 d'Apple renvoie aux lois sur la vie privée des enfants des pays où l'app est proposée. **À voir avec votre avocat** avant de cocher (rapport d'audit, partie 1, « Pour ton avocat », point 4).

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

- « Votre app contient-elle, affiche-t-elle ou donne-t-elle accès à du contenu de tiers ? » → **Oui**, c'est un fait : images, titres et prix des marchands et de Google dans les résultats (venus de Google Lens et de Google Shopping, par SerpApi), publications des utilisateurs.
- La case suivante (« disposez-vous des droits nécessaires… ») : 🙋 à vous, **avec votre avocat** : c'est une déclaration que vous signez, et la règle 5.2.2 d'Apple demande d'être expressément autorisé par le service dont on affiche le contenu (rapport d'audit, partie 2).

---

## 5. Rappel : le compte Apple Developer

Le nom du vendeur affiché sur l'App Store vient du compte : votre nom (compte de particulier) ou celui de la société (compte d'organisation, avec un numéro D-U-N-S). Voir la feuille de route, partie 7, étape 7. 🙋
