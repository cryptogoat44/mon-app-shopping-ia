// Virtual photo try-on, iPhone app: the only texts specific to the iPhone
// (same rules as tryon-iphone-fr.ios.ts, which remains the reference:
// TypeScript refuses a missing or extra key). Written in natural, restrained
// English rather than word for word; the product name always comes from BRAND.
import { APP_NAME_DISPLAY as BRAND } from "../constants/brand";
import type { TryonIphoneCatalog } from "./tryon-iphone-fr.ios";

export const tryonIphoneEn: TryonIphoneCatalog = {
  consent: {
    updateBody: `The try-on consent text has been updated. This version of ${BRAND} doesn't include it yet: update the app to read it before accepting it.`,
  },
  save: {
    saved: "Image saved to your photos.",
    denied: `Adding to your photos isn't allowed. To save the image, allow it in your iPhone's Settings, under ${BRAND}, then Photos.`,
    failed: "The image couldn't be saved to your photos. Please try again.",
  },
};
