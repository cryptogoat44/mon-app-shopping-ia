// Le lien de vidéo en attente de cet appareil (lib/pending-video-link.ts),
// rangé par AsyncStorage (localStorage sur le site). À part de
// video-context.ts pour que la session (auth-context.tsx) puisse l'oublier à
// la déconnexion sans charger tout le Spotter.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createPendingLinkStore } from "./pending-video-link";

export const pendingVideoLinks = createPendingLinkStore(AsyncStorage, () => Date.now());
