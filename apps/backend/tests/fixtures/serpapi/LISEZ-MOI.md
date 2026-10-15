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
