# Polices gardées avec le serveur

Deux fichiers de police, tous deux sous licence libre **SIL Open Font License 1.1**. Pour chacun, le texte complet de la licence et la mention du droit d'auteur sont dans un fichier à garder à côté de lui.

## `BodoniModa_500Medium.ttf` : la police de l'app et du logo

Bodoni Moda Medium (droite), du projet Bodoni Moda (indestructible type), choisie par le fondateur le 17 novembre 2026 pour le nom de l'app, les titres et les noms de pièces. Licence : `OFL-BodoniModa.txt`.

Copie exacte, sans modification, du fichier du paquet `@expo-google-fonts/bodoni-moda` 0.4.2 (Google Fonts), celui que l'app charge ; empreinte SHA-256 `ba0aaf95aa18d8c91c67f64085cebce6f6000e2b3e4ab3140400e31e803d6b84`.

Le script `scripts/images-marque.ts` (`pnpm --filter backend images-marque`) y lit le contour du « S » et dessine avec lui l'icône de l'app, l'icône du site, les icônes Android et les écrans de démarrage (`apps/mobile/assets`). Le serveur lui-même ne s'en sert pas.

## `Newsreader_500Medium.ttf` : la police du bandeau « Image générée par IA »

Newsreader Medium, de Production Type. Licence : `OFL.txt`. C'était la police de l'app jusqu'au 17 novembre 2026 ; elle reste celle du bandeau, un petit texte que ses traits plus épais gardent lisible sur une image réduite.

Copie exacte, sans modification, du fichier du paquet `@expo-google-fonts/newsreader` 0.4.1 (Google Fonts) ; empreinte SHA-256 `64dadba9c887b4c871dfdc7d3146ae1e288cc26940baeacf9a313a30fd06e2d9`.

Le serveur dessine avec elle le bandeau ajouté à chaque image d'essayage virtuel (`src/lib/tryon/band.ts`). Elle est chargée depuis ce fichier : le rendu ne dépend d'aucune police installée sur le serveur.
