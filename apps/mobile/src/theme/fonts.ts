import { useFonts } from "expo-font";
// Import par sous-chemin, un fichier par graisse : importer le paquet entier
// embarquerait les 18 variantes de Newsreader dans le site web.
import { Newsreader_500Medium } from "@expo-google-fonts/newsreader/500Medium";
import { Newsreader_600SemiBold } from "@expo-google-fonts/newsreader/600SemiBold";

export function useAppFonts() {
  return useFonts({
    Newsreader_500Medium,
    Newsreader_600SemiBold,
  });
}
