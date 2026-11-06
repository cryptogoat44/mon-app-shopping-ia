# Les captures d'écran de la fiche

*Chantier 8, point 8 de la feuille de route V1. Pour le fondateur. Aucune capture n'est fournie ici : elles se font après le premier build, avec le compte de démonstration.*

---

## 1. Les tailles exigées par Apple

⚠️ **À vérifier dans App Store Connect le jour de l'envoi** : Apple change ces règles. Ce qui suit vient de la page officielle, lue le 6 novembre 2026 : https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/. Elle n'est pas limpide ; la page « Captures d'écran » de la version, dans App Store Connect, dit elle-même quelles tailles manquent.

- **iPhone seulement** : l'app n'est pas faite pour l'iPad (`apps/mobile/app.json:20`, `"supportsTablet": false`). Aucune capture iPad.
- **De 1 à 10 captures par taille**, au format PNG ou JPEG, **sans transparence**.
- **Obligatoire** : la taille « iPhone avec Dynamic Island, écran moyen » : **1206 × 2622** ou **1179 × 2556** pixels, en portrait.
- **Conseillé en plus** : la grande taille, « iPhone avec Dynamic Island, grand écran » : **1320 × 2868** (ou 1290 × 2796, 1260 × 2736). La page la dit remplacée, à défaut, par l'ancienne taille de 6,5 pouces (1284 × 2778 ou 1242 × 2688), elle-même obligatoire si la grande manque. Le plus simple : fournir 1320 × 2868 **et** 1206 × 2622.
- Apple réduit lui-même ces captures pour les iPhone plus petits.

| iPhone qui fait la capture | Taille obtenue | Case d'App Store Connect |
|---|---|---|
| iPhone 17 Pro Max, 16 Pro Max | 1320 × 2868 | grand écran |
| iPhone 17 Pro, 16 Pro | 1206 × 2622 | écran moyen (obligatoire) |
| iPhone 16, 15, 15 Pro | 1179 × 2556 | écran moyen (obligatoire) |
| iPhone 14, 13 | 1170 × 2532 | ⚠️ pas une taille obligatoire : passer par le simulateur |

(Les tailles par modèle sont celles que je connais : vérifiez avec `sips`, partie 4.)

---

## 2. Les écrans à capturer, dans l'ordre

La **première** capture compte le plus : c'est elle qu'on voit dans les résultats de recherche de l'App Store. Les légendes sont facultatives : à écrire en haut de l'image si vous la retouchez (Keynote, Canva…), sinon ne rien ajouter. Faites la série en français, puis la même en anglais (Réglages de Spotto → Langue).

| # | Écran | Ce qu'on doit y voir | Légende FR | Légende EN |
|---|---|---|---|---|
| 1 | **Spotter** (accueil) | les boutons « Ajouter une vidéo », « Ajouter une photo », « Prendre une photo », et des pièces dans « Récemment spottées » | Vue dans une vidéo ? Retrouvez-la. | Saw it in a video? Find it. |
| 2 | **Entourez la pièce** | une capture d'écran de vidéo, la pièce entourée au doigt | Entourez la pièce, c'est tout. | Just circle the piece. |
| 3 | **Résultats** | « Meilleure proposition avec prix », avec le prix et « Voir chez … » | Où l'acheter, prix en tête. | Where to buy it, prices first. |
| 4 | **Partager vers Spotto** | la feuille de partage d'iOS ouverte sur une photo, avec l'icône « Spotto » | Partagez vers Spotto depuis Photos. | Share to Spotto from Photos. |
| 5 | **Vidéo** | « Votre dernière vidéo » ou le choix du moment dans une vidéo | Vos vidéos, au bon moment. | Your videos, at the right moment. |
| 6 | **Envies** | quelques pièces gardées | Gardez vos coups de cœur. | Save the pieces you love. |
| 7 | **Vault** (Profil) | des pièces possédées, avec leur photo | Votre dressing, dans le Vault. | Your wardrobe, in the Vault. |
| 8 | **Fil** | deux ou trois publications, avec j'aime et commentaires | Partagez votre style. | Share your style. |
| 9 (facultatif) | **Réglages → Vos données** | les interrupteurs « statistiques d'usage » et « analyse automatique des vidéos » | Vos données, vos choix. | Your data, your choices. |

**Règles à respecter** (règles 2.3.3 et 2.3.8 d'Apple, et prudence) :
- montrer l'app **en marche**, pas seulement l'écran d'accueil, de connexion ou de démarrage ;
- tout doit convenir à un public de **4 ans** : pas de maillot de bain, de lingerie ni de tenue suggestive, même si l'app est classée 13+ ;
- du **vrai contenu**, celui du compte de démonstration, jamais de texte « [À compléter] » ;
- évitez les visages de personnes qui n'ont pas donné leur accord, et les grands logos de marques en gros plan ;
- ne montrez « Cette pièce dans d'autres boutiques » ou « Pas tout à fait ça ? » (voie C) **que si** la voie C est allumée le jour de l'envoi ; ne montrez jamais le lecteur intégré TikTok / Instagram tant qu'il n'est pas dans le build ;
- une barre d'état propre (heure, batterie pleine) : voir partie 4 ;
- le **thème clair** pour toute la série (ou le sombre pour toute la série), pas un mélange.

---

## 3. Sur votre iPhone (le plus simple, après le premier build TestFlight)

1. Installez le build depuis TestFlight, connectez-vous avec le compte de démonstration.
2. Préparez chaque écran, puis appuyez en même temps sur le **bouton latéral** et le bouton **volume +**.
3. Envoyez les captures sur le Mac par AirDrop (app Photos → sélectionner → Partager → AirDrop).
4. Vérifiez la taille (partie 4). Si votre iPhone ne donne pas une taille du tableau de la partie 1, passez par le simulateur.

---

## 4. Sur le simulateur du Mac (pour obtenir les tailles exactes)

Il faut Xcode sur le Mac. Le profil de build `development-simulator` existe déjà (`apps/mobile/eas.json`).

1. Fabriquer le build pour le simulateur : `eas build --profile development-simulator --platform ios` (dans `apps/mobile`), puis `eas build:run --platform ios --latest` : il s'installe dans le simulateur.
2. Ouvrir le simulateur sur le bon iPhone : Simulator → **File → Open Simulator** → **iPhone 17 Pro Max** (grand écran), puis **iPhone 17 Pro** (écran moyen).
3. Lancer le code : `pnpm --filter mobile start`, puis ouvrir Spotto dans le simulateur. ⚠️ Le code lit alors `apps/mobile/.env` du Mac : pour montrer le contenu du compte de démonstration, il faut que ce fichier vise le même serveur et la même base que le build envoyé à Apple (les adresses et la clé **publique** de l'environnement « production » chez Expo, jamais une clé secrète). Remettez ensuite vos valeurs habituelles.
4. Une barre d'état propre, dans le Terminal :
   `xcrun simctl status_bar booted override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3`
5. Une capture : menu **File → Save Screen** (Cmd + S, elle arrive sur le Bureau), ou dans le Terminal :
   `xcrun simctl io booted screenshot ~/Desktop/spotto-01.png`
6. Vérifier la taille : `sips -g pixelWidth -g pixelHeight ~/Desktop/spotto-01.png`
7. Si App Store Connect refuse l'image pour une transparence : `sips -s format jpeg ~/Desktop/spotto-01.png --out ~/Desktop/spotto-01.jpg`
8. Pour l'écran « Partager vers Spotto » dans le simulateur : faites glisser une photo du Mac sur le simulateur (elle va dans Photos), ouvrez-la, touchez Partager.

---

## 5. Les déposer

App Store Connect → Spotto → la version → **Aperçus et captures d'écran** → **iPhone** → choisir la taille → faire glisser les images **dans l'ordre** de la partie 2. Une série par langue : Français, puis Anglais. Une vidéo d'aperçu (*App Preview*) est facultative : pas nécessaire pour la V1.
