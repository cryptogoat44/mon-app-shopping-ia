// Site : jamais de lecteur intégré, donc jamais d'instantané. Version app
// iPhone : player-snapshot.ts.
import type { PlayerSnapshot } from "./player-snapshot";

export type { PlayerSnapshot };

export const snapshotAvailable = false;

export async function snapshotPlayer(_viewTag: number): Promise<PlayerSnapshot> {
  throw new Error("player snapshot unsupported on the web");
}
