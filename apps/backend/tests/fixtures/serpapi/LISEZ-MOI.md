# Réponses enregistrées de SerpApi (Google Lens)

Les tests rejouent ces réponses : **aucun appel réel à SerpApi, aucun crédit**.

## Origine

Trois recherches réelles faites le 24 septembre 2026 sur spotto-dev, pendant le Lot S (3 crédits). Elles portaient sur une veste en daim marron, vue dans une vidéo :

| Fichier | Image envoyée | Texte | Réponse |
|---|---|---|---|
| `lens-vignette-entiere-vide.json` | vignette entière de la vidéo | aucun | aucune proposition (« Fully empty ») |
| `lens-veste-daim-zone.json` | zone recadrée sur la veste | aucun | 60 propositions |
| `lens-veste-daim-zone-texte.json` | même zone | « veste en daim marron » | 60 propositions |

## Ce qui a été retiré avant de les verser au dépôt (public)

- **Seuls les champs lus par le serveur sont gardés** : position, titre, lien, marchand, vignette, image, prix, et `in_stock`.
- **Rubriques absentes** : à l'époque, seule la liste des propositions avait été gardée pour les deux recherches abouties. Pour la recherche vide, l'adresse de l'image et les identifiants de recherche ont été retirés.
- **Anonymisé** : les liens vers des comptes de réseaux sociaux (TikTok, Instagram) et vers des annonces de particuliers (Leboncoin), avec leurs images. Tout le reste est tel que SerpApi l'a renvoyé.

## Neutralisées le 20 octobre 2026 (dépôt public, décision du fondateur)

Les trois réponses ont été repassées dans `reponseDeTest` (`scripts/lib/essai-type.ts`, testée dans `tests/essaiType.test.ts`), comme le seront les réponses des prochains essais.

**Remplacé** :
- **titres** → « Produit N » ; un titre qui contenait le nom de son site le garde (« Produit 3 - ZALANDO.FR ») ;
- **noms de marchands** → « Marchand N » ;
- **chemins des liens** → `/produit-N` ;
- **images** → `https://example.invalid/…` ;
- **publications de réseaux sociaux** : lien `…/compte-anonyme/…` et titre « Publication anonymisée » ;
- **annonces de particuliers** (Leboncoin, Vinted, Depop, Vestiaire Collective) : lien `…/annonce/…`.

**Gardé tel quel, parce que les filtres, les tests ou la mesure en dépendent** :
- les **positions** : l'ordre de Google, et les tests désignent les propositions par leur position ;
- les **prix et devises** (« 730 MAD », prix absents) : affichage des prix, valeurs étranges, mesure des prix ;
- les **domaines** des liens : réseaux sociaux et vente aux professionnels écartés, site du pays préféré (zalando.fr plutôt que zalando.ch) ;
- les **paramètres** des liens (`?colour=chocolate`) : test des paramètres de suivi ;
- `in_stock`, l'état de Google (« Fully empty ») et le message de SerpApi.

**Les relations restent vraies** : deux titres identiques, ou identiques au nom du site près, et deux chemins identiques reçoivent la même valeur neutre. Les filtres prennent donc les mêmes décisions qu'avant (13 tests sur 13).

Seule différence voulue : les deux publications de réseaux sociaux de la réponse avec texte (positions 17 et 57) portent maintenant le même titre. Elles sont écartées avant la recherche des doublons.

**À savoir** :
- les cas d'incohérence ci-dessous se lisaient dans les titres d'origine ; ils restent décrits ici, mais ne se voient plus dans les fichiers. Aucun test n'en dépend ;
- les versions d'avant restent dans l'historique de Git (dépôt public).

## Cas d'incohérence présents

1. **Titre qui nomme une autre pièce que l'image** : un chemisier, un sac, un body, un short, pour une veste.
2. **Pièce absente** : la recherche vide (vignette entière).
3. **Hors sujet** :
   - vente aux professionnels (Faire) ;
   - pages de catégorie ou comparateur (Stylight) ;
   - occasion (Leboncoin) ;
   - réseaux sociaux.
4. **Prix** :
   - 40 propositions sur 60 sans prix, dans chaque réponse ;
   - un prix en dirhams marocains (730 MAD) ;
   - des sites d'autres pays.
5. **Quasi-doublons** :
   - le même article sur zalando.ch et zalando.fr ;
   - deux titres identiques chez Shein et chez NA-KD, à des adresses différentes.

**Absents** : un lien avec paramètre de suivi (aucun sur 120), et une panne de SerpApi. Ces cas restent couverts par des réponses fabriquées dans `visualSearch.test.ts`.
