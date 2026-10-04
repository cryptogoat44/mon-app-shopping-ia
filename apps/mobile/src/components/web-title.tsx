import { Platform } from "react-native";
import Head from "expo-router/head";

// Titre de l'onglet du navigateur : site uniquement. Sur iPhone,
// expo-router/head sert au « Handoff » d'Apple et exige une adresse de site
// déclarée dans la configuration ; sans usage pour Spotto, il faisait planter
// l'app dès l'ouverture (constaté sur le simulateur, lot 3bis).
export function WebTitle({ title }: { title: string }) {
  if (Platform.OS !== "web") return null;
  return (
    <Head>
      <title>{title}</title>
    </Head>
  );
}
