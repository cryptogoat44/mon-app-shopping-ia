import { Redirect } from "expo-router";

// « Tout voir » (lot « Retrouver ses pièces ») montrait les 20 dernières
// recherches. Retours du build 2, lot « historique » : tout l'historique est
// désormais sur l'accueil de Spotter, en descendant, avec une recherche. Cette
// adresse reste pour les anciens liens : elle ramène à l'accueil.
export default function RecentSearchesScreen() {
  return <Redirect href="/" />;
}
