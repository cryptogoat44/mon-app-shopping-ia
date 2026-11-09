import { useEffect, useState } from "react";
import type { WishAlertsStatus } from "@monapp/shared-types";
import { onWishAlertsStatus, wishAlertsStatus } from "./wish-alerts";

/** Disponibilité des alertes prix et stock, interrupteur et notifications,
 * tels que lus au dernier rafraîchissement. Sans les alertes sur le serveur,
 * `available` est faux : cloche, interrupteur et « Plus disponible » sont cachés. */
export function useWishAlertsStatus(): WishAlertsStatus {
  const [status, setStatus] = useState<WishAlertsStatus>(wishAlertsStatus);
  useEffect(() => {
    setStatus(wishAlertsStatus());
    return onWishAlertsStatus(setStatus);
  }, []);
  return status;
}
