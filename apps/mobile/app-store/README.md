# Le dossier pour Apple (App Store)

*Chantier 8, point 8 de la feuille de route V1. Pour le fondateur. Rien de secret ici : le dépôt est public. Identifiants, coordonnées et mots de passe restent « [À compléter] » et se saisissent seulement dans App Store Connect. Dossier relu le 21 novembre 2026 sur le code de `main` (0474313).*

Les fichiers, dans l'ordre où vous en aurez besoin dans App Store Connect :

1. [AGE-ET-PAYS.md](AGE-ET-PAYS.md) : vos choix (âge, pays, statut professionnel), en cases à cocher.
2. [FICHE.md](FICHE.md) : nom, sous-titre, textes, mots-clés, catégorie, adresses, en français et en anglais.
3. [CONFIDENTIALITE-APPLE.md](CONFIDENTIALITE-APPLE.md) : les réponses « App Privacy », type par type, et les écarts relevés avec la politique de confidentialité.
4. [CAPTURES.md](CAPTURES.md) : les écrans à capturer, les tailles, comment faire.
5. [CONTROLE-BUILD.md](CONTROLE-BUILD.md) : la liste à cocher avant chaque envoi, dont le compte de démonstration.
6. [NOTES-VALIDATION.md](NOTES-VALIDATION.md) : les notes pour l'équipe de validation (l'anglais est à coller).

Fabriquer et envoyer le build : [../BUILD-IPHONE.md](../BUILD-IPHONE.md), section 5.

**Le jour où le compte Apple Developer est activé**, dans cet ordre :

1. **Les décisions qui changent le build ou les textes** : le lecteur officiel TikTok / Instagram dans le build ou non, l'analyse d'un lien allumée ou non, les notifications allumées ou non ([NOTES-VALIDATION.md](NOTES-VALIDATION.md), partie 1, points 10 à 12).
2. **Le premier build, pour TestFlight**, après les parties A à D de [CONTROLE-BUILD.md](CONTROLE-BUILD.md). Installé par vous seul, comme testeur interne (jusqu'à 100 personnes de votre équipe App Store Connect), il n'attend pas la validation d'Apple. Le premier build donné à des testeurs externes, lui, y passe (page TestFlight d'Apple : « When you add the first build of your app to a group, the build gets sent to App Review »), avec une description, ce qu'il faut tester et une adresse e-mail pour les retours. Un build reste testable 90 jours.
3. **Avec ce build** : les comptes de démonstration ([CONTROLE-BUILD.md](CONTROLE-BUILD.md), partie E) et les captures ([CAPTURES.md](CAPTURES.md)).
4. **Dans App Store Connect** : l'âge et les pays, la fiche, la déclaration « App Privacy », puis les notes pour la validation.
5. **La partie F** de [CONTROLE-BUILD.md](CONTROLE-BUILD.md), puis « Soumettre pour vérification ».
