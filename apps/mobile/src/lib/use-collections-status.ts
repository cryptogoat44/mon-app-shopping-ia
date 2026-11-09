import { useEffect, useState } from "react";
import type { CollectionsStatus } from "@monapp/shared-types";
import { collectionsStatus, onCollectionsStatus } from "./collections";

/** Disponibilité des collections, telle que lue au dernier rafraîchissement.
 * Sans les collections sur le serveur, `enabled` est faux : tout est caché. */
export function useCollectionsStatus(): CollectionsStatus {
  const [status, setStatus] = useState<CollectionsStatus>(collectionsStatus);
  useEffect(() => {
    setStatus(collectionsStatus());
    return onCollectionsStatus(setStatus);
  }, []);
  return status;
}
