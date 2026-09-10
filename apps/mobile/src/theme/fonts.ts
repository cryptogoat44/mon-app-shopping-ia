import {
  useFonts,
  Newsreader_500Medium,
  Newsreader_600SemiBold,
} from "@expo-google-fonts/newsreader";

export function useAppFonts() {
  return useFonts({
    Newsreader_500Medium,
    Newsreader_600SemiBold,
  });
}
