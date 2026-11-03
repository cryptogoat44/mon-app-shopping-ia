import { Stack } from "expo-router";
import { AppNotices } from "@/components/app-notices";
import { useSharedItemArrival } from "@/lib/use-shared-item";

export default function AppLayout() {
  // Partage reçu pendant qu'un autre écran est affiché : retour au Spotter, qui
  // l'ouvre, seulement si rien ne se perd ; pendant une recherche ou une saisie,
  // il attend le retour au Spotter.
  useSharedItemArrival();
  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        {/* iPhone : glisser vers la droite (n'importe où sous iOS 26) fait revenir en
            arrière. Pendant l'attente de l'identification, ce geste quittait l'écran et
            abandonnait la requête : une recherche peut-être payée, sans son résultat
            (lot recherche coupée). Retour par « Annuler » ou « Fermer ». */}
        <Stack.Screen name="spot/analysis" options={{ gestureEnabled: false }} />
        <Stack.Screen name="post-item/new" options={{ presentation: "modal" }} />
        {/* Lot 2 (Vault) : ajout d'une pièce à la main, présenté comme « Nouvelle publication ». */}
        <Stack.Screen name="vault-item/new" options={{ presentation: "modal" }} />
        {/* iPhone : glisser vers la droite fait revenir en arrière (iOS 26 : n'importe
            où sur l'écran). Ce geste du système coupait le curseur de la frise et le
            recadrage dès qu'on allait vers la droite (lot 4). Retour par « ‹ ». */}
        <Stack.Screen name="spot/video" options={{ gestureEnabled: false }} />
        <Stack.Screen name="spot/ciblage" options={{ gestureEnabled: false }} />
        {/* Le cadre « Entourez la pièce » vit aussi ici depuis le lot 4 ter : tirer
            le cadre vers la droite risquait de ramener à Spotter, cadre et mots
            perdus (lot « premier essai », à confirmer sur iPhone). Retour par « ‹ »
            ou « Fermer ». */}
        <Stack.Screen name="spot/lancer" options={{ gestureEnabled: false }} />
      </Stack>
      {/* Messages discrets (information de mise à jour, demande « statistiques ») et réglage de la collecte. */}
      <AppNotices />
    </>
  );
}
