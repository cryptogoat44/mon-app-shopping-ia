# Classement par âge, pays, statut professionnel : les réponses proposées

*Chantier 8, point 8 de la feuille de route V1. Pour le fondateur. Aucune question juridique ici : des faits tirés du code, et des cases à cocher. Ce qui est à vous est marqué 🙋.*

*Remis à jour le 21 novembre 2026, sur le code de `main` (0474313) et sur les pages d'Apple relues ce jour-là. Ce qui change : deux questions nouvelles dans le questionnaire (« Partage de la position », « Rencontres et relations » : **Non** toutes les deux) ; le fil « Pour vous » confirme « Réseau social : Oui » ; et surtout, **Apple demande de remplacer le classement calculé (13+) par un classement plus élevé quand les conditions d'utilisation fixent un âge minimum supérieur** : Spotto demande 15 ans, donc **16+** (fin de partie 1). Règle 2.3.6 d'Apple : « Answer the age rating questions in App Store Connect honestly so that your app aligns properly with parental controls. »*

Sources (relues le 21 novembre 2026) : les définitions, https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions/, et la marche à suivre, https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/. Apple classe en **4+, 9+, 13+, 16+ et 18+** ; il calcule le classement d'après les réponses (« Apple generates appropriate ratings based on your answer to the age rating questionnaire »), et le plus élevé qu'entraîne l'une d'elles l'emporte.

**Où** : App Store Connect → Spotto → **Informations sur l'app** (*App Information*, rubrique « Général ») → **Classification par âge** → **Configurer** (*Set Up Age Ratings*) la première fois, **Modifier** ensuite (libellés français à vérifier à l'écran).

---

## 1. Le questionnaire, réponse par réponse

### Contrôles dans l'app (*In-App Controls*)

| Question | Réponse proposée | Pourquoi (d'après le code) |
|---|---|---|
| Contrôle parental | **Non** | Aucun réglage pour les parents dans l'app. |
| Vérification de l'âge (*Age Assurance*) | **Non** | L'app demande seulement de certifier « au moins 15 ans » d'une case, sans vérification (`apps/mobile/src/app/sign-up.tsx:56`, politique `apps/mobile/src/legal/confidentialite.ts:161`). Apple : « Mechanism to confirm an individual's age meets the age requirement for accessing specific content or services. » Une case à cocher ne confirme rien : Spotto n'a pas de tel mécanisme. |

### Fonctions (*Capabilities*)

| Question | Réponse proposée | Effet sur l'âge | Pourquoi (d'après le code) |
|---|---|---|---|
| Contenu créé par les utilisateurs | **Oui** | 4+ | Publications (jusqu'à 5 photos, personnes identifiées), commentaires et réponses, mentions, profils (bio, photo, lien), messages privés, noms de collections (`apps/backend/src/routes/posts.ts`, `comments.ts`, `me.ts`, `conversations.ts`, `collections.ts`). |
| Réseau social (*Social Media*) | **Oui** | **13+** | Apple : « Redistribution, amplification, or interaction with user-generated content through a social feed or similar discovery method that visibly spreads content to many users. » C'est le fil de Spotto (j'aime, commentaires), et plus encore, depuis le 20 novembre 2026, le fil « Pour vous » et les comptes à découvrir, qui montrent les publications publiques à des membres qui ne suivent pas leur auteur (`apps/backend/src/lib/forYou.ts`). |
| Réseau social coupé avant 13 ans | **Non** | — | Il faudrait appeler l'API d'âge d'Apple (*Declared Age Range*) : rien de tel dans le code. |
| Messagerie et discussion | **Oui** (ce n'est pas un choix) | 4+ (confirmé sur la page d'Apple le 21 novembre 2026) | Apple : « Users can directly communicate with one another through features within the app. » **Des messages privés avec du texte libre existent** : jusqu'à 1 000 caractères, plus la « carte » d'une envie ou une publication ; j'aime, réponses, suppression, « Vu » (migrations 0043 et 0044) ; pas de photo libre (`apps/backend/src/routes/conversations.ts`, `packages/shared-types/src/index.ts` : `MESSAGE_MAX_LENGTH`, table `messages` de la migration 0032). Deux amis s'écrivent directement ; par défaut, **tout membre peut envoyer une invitation à tout autre membre** (réglage « Qui peut m'écrire », défaut « Tout le monde » : `DEFAULT_MESSAGES_FROM`). Garde-fous : une seule invitation, refus discret, blocage, signalement d'un message, filtre de mots, 10 invitations par heure (`apps/backend/src/lib/messaging.ts:1-12`). |
| Partage de la position (*Shared Location*) | **Non** | — | Nouvelle question. Aucune position n'est demandée ni partagée : pas d'autorisation de localisation (`apps/mobile/app.json`). |
| Publicité | **Non** | — | Apple : « Paid promotion of products or services within the app. » Aucune publicité ; les liens des boutiques ne sont pas payés (aucun programme d'affiliation actif). |
| Accès libre au web (*Unrestricted Web Access*) | 🙋 à cocher ci-dessous | **16+** si « Oui » | Apple : « Users can navigate to any webpage within the app or freely browse the web. » Chez Spotto, « Voir chez… » ouvre **la page du marchand** dans une fenêtre Safari intégrée (`apps/mobile/src/lib/merchant-links.ts`, `WebBrowser.openBrowserAsync`) : on peut y suivre les liens du site, pas taper une autre adresse (à vérifier sur l'iPhone). Le lien d'un profil s'ouvre **hors de l'app**, dans Safari, après l'écran « Vous allez quitter… » (`apps/mobile/src/components/external-link-sheet.tsx`). Le lecteur officiel TikTok / Instagram n'ouvre aucun lien (`apps/mobile/src/components/embedded-player.tsx`). |

**Messagerie et discussion : Oui.** Répondre « Non » serait faux. Si l'écran d'Apple pose des sous-questions (discussion avec des inconnus, contenu filtré ou non, signalement), les faits sont dans la ligne du tableau : une invitation d'un inconnu est possible par défaut ; les textes passent par un filtre de mots ; chaque message reçu se signale.

🙋 **Accès libre au web**
- [ ] **Non** (conseillé : c'est la réponse exacte d'après le code) : l'app n'ouvre que des pages de marchands précises, sans barre d'adresse à taper ; les liens des membres partent dans Safari, hors de l'app.
- [ ] **Oui** : seulement si vous jugez que la fenêtre Safari des boutiques permet de « naviguer librement ». Pas pour obtenir 16+ : la règle 2.3.6 demande des réponses honnêtes, et 16+ s'obtient autrement (fin de partie 1).

### Thèmes pour adultes, santé, sexualité, violence, hasard

| Question | Réponse proposée | Pourquoi |
|---|---|---|
| Grossièretés ou humour cru | **Aucun** | Un filtre refuse les mots injurieux (`apps/backend/src/lib/contentFilter.ts`, appliqué par `comments.ts:120`, `posts.ts:483`, `apps/backend/src/routes/me.ts:185`). Le contenu des utilisateurs est déjà couvert par la question « Contenu créé par les utilisateurs ». |
| Horreur, peur | **Aucun** | — |
| Alcool, tabac, drogues | **Aucun** | — |
| Rencontres et relations (*Dating and Relationships*) | **Non** | Nouvelle question (18+ si « Oui »). Apple : « Features that enable dating or relationship connections between real people and/or a virtual companion that engages a user in sexual or romantic content. » Spotto n'a rien de tel : on y parle de mode, entre membres. |
| Santé, bien-être ; informations médicales | **Aucun** | — |
| Thèmes suggestifs (*Mature or Suggestive Themes*) | 🙋 à cocher ci-dessous | Les résultats d'une recherche de mode peuvent montrer des maillots de bain ou de la lingerie, venus des marchands. |
| Contenu sexuel, nudité | **Aucun** | — |
| Violence (dessin animé, réaliste, prolongée) ; armes | **Aucun** | — |
| Concours, jeux d'argent simulés ou réels, coffres à butin | **Aucun** | — |

🙋 **Thèmes suggestifs**
- [ ] **Aucun**.
- [ ] **Rares** (*Infrequent*), par prudence : 9+, donc sans effet sur le classement final. (« Fréquents » mènerait à 16+ : ce n'est pas le cas.)

### Le classement obtenu

- **Calculé par Apple** avec les réponses conseillées : **13+** (« Réseau social : Oui » ; la messagerie reste à 4+ d'après la page d'Apple du 21 novembre 2026 ; si l'écran calcule autre chose, c'est son calcul qui vaut).
- **À afficher : 16+**, par le choix *Override to Higher Age Rating* (sous « Age Categories and Override », à la fin du questionnaire ; libellés français à vérifier à l'écran), en choisissant 16+ dans le menu. Apple, page « Set an app age rating » : « If your app has a EULA with minimum age requirements that exceed the rating that Apple calculated, you must override to a rating that adheres to the requirements. » Les conditions d'utilisation de Spotto, acceptées à l'inscription, demandent **15 ans** (`apps/mobile/src/legal/conditions.ts`, « Votre compte ») ; elles jouent le rôle de contrat d'utilisation, même si vous gardez le contrat standard d'Apple dans App Store Connect (lecture prudente). C'est au-dessus de 13+, et Apple n'a pas de 15+ ; le premier classement qui respecte 15 ans est 16+. Apple précise : « App Store will display this specified age rating, and the content descriptions will still reflect your questionnaire answers » (les réponses restent les mêmes ; seul l'âge affiché change).
- **Australie** : la mention « un réseau social y est classé 16+ », écrite ici le 6 novembre, ne figure pas sur la page d'Apple relue le 21 novembre 2026 : le classement propre à l'Australie n'y vise que certains jeux (coffres à butin, jeux d'argent simulés). Rien de particulier pour Spotto, d'après cette page.

🙋 **L'âge de l'app et celui d'Apple : votre choix** (décision D de l'audit). L'app demande 15 ans, par une case à cocher, sans contrôle (`apps/mobile/src/app/sign-up.tsx`) ; Apple n'a pas de « 15+ ». Les options :
- [ ] **16+, par « Override to Higher Age Rating »** (conseillé : c'est ce que demande la page d'Apple citée plus haut, tant que les conditions disent 15 ans). À savoir : avec les contrôles parentaux d'iOS, des personnes de 15 ans que l'inscription accepterait ne pourront pas télécharger l'app ; en échange, l'App Store ne la propose plus à des 13-14 ans que l'inscription refuse.
- [ ] **13+ calculé** : seulement si les conditions d'utilisation et l'app descendaient à 13 ans (textes légaux et `MINIMUM_AGE` à changer, hors de ce dossier). Garder 13+ avec des conditions à 15 ans contredirait la consigne d'Apple.

À part, et quel que soit le classement : un réglage « Qui peut m'écrire » plus strict par défaut (« Comptes que je suis ») reste possible ; c'est un changement de code, à demander (décision C de l'audit). Les 15-17 ans restent concernés (16+ laisse passer les 16-17 ans) : la règle 5.1.4 d'Apple invite à respecter les lois sur les données des enfants (« COPPA », « GDPR » et les autres lois applicables) des pays où l'app est proposée (rapport d'audit, partie 1, point 4).

**Bon à savoir** : les captures d'écran et l'icône doivent convenir à un public de 4 ans, quel que soit le classement (règle 2.3.8). Voir [CAPTURES.md](CAPTURES.md).

---

## 2. Les pays

**Où** : App Store Connect → Spotto → **Prix et disponibilité** → **Disponibilité de l'app**.

Les faits utiles :
- L'app existe en **français** et en **anglais** seulement (`apps/mobile/app.json:25-28`).
- En français, les recherches visent la **France** ; en anglais, la région réglée sur l'iPhone, à défaut les **États-Unis** (`apps/backend/src/lib/locale.ts:24-28`).
- La feuille de route conseille la France et l'Union européenne pour la V1 (point 8), et signale, pour les États-Unis, une loi du Texas sur l'âge (à vérifier).
- Hors de l'Europe, la page d'Apple prévoit des classements propres à certains pays : un réseau social y est classé **15+** en Corée du Sud et **16+** au Viêt Nam ; l'Australie n'a de classement propre que pour certains jeux. Les lois locales sur l'âge minimum des réseaux sociaux sont une autre question, à vérifier pays par pays si vous choisissez le monde entier.
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

- « Votre app contient-elle, affiche-t-elle ou donne-t-elle accès à du contenu de tiers ? » → **Oui**, c'est un fait : images, titres et prix des marchands et de Google dans les résultats (venus de Google Lens et de Google Shopping, par SerpApi), publications des utilisateurs, vidéos TikTok et Instagram dans leur lecteur officiel (s'il est dans le build) et images tirées d'une vidéo publique (si l'analyse d'un lien est allumée).
- La case suivante (« disposez-vous des droits nécessaires… ») : 🙋 à vous : c'est une déclaration que vous signez. Règle 5.2.2 d'Apple : « If your app uses, accesses, monetizes access to, or displays content from a third-party service, ensure that you are specifically permitted to do so under the service's terms of use. Authorization must be provided upon request. » (rapport d'audit, partie 2 ; pour TikTok et Instagram, [NOTES-VALIDATION.md](NOTES-VALIDATION.md), partie 1, points 11 et 12).

---

## 5. Rappel : le compte Apple Developer

Le nom du vendeur affiché sur l'App Store vient du compte : votre nom (compte de particulier) ou celui de la société (compte d'organisation, avec un numéro D-U-N-S). Voir la feuille de route, partie 7, étape 7. 🙋
