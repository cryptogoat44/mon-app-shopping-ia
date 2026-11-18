import { useFonts } from "expo-font";
// Import par sous-chemin, un fichier par graisse : importer le paquet entier
// embarquerait les 12 variantes de Bodoni Moda dans le site web. Une seule
// graisse sert (Medium, droite) : nom de l'app, titres, noms de pièces.
import { BodoniModa_500Medium } from "@expo-google-fonts/bodoni-moda/500Medium";

export function useAppFonts() {
  return useFonts({
    BodoniModa_500Medium,
  });
}
