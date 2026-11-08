// Site : aucun lecteur intégré, le site garde son comportement (aide
// « capture d'écran d'abord »). Version app iPhone : player-capture.ts.
import type * as Native from "./player-capture";

export const playerPlatforms: typeof Native.playerPlatforms = () => [];
export const isPlayerAvailable: typeof Native.isPlayerAvailable = () => false;
export const screenConsentNeeded: typeof Native.screenConsentNeeded = () => false;
export const markScreenConsentShown: typeof Native.markScreenConsentShown = () => {};
export const pauseMedia: typeof Native.pauseMedia = async () => "unknown";
export const mediaState: typeof Native.mediaState = async () => "unknown";
export const reportBlackImage: typeof Native.reportBlackImage = async () => {};
export const captureMoment: typeof Native.captureMoment = () => Promise.reject(new Error("player_unavailable"));
export const readPlayerConsent: typeof Native.readPlayerConsent = async () => ({ tiktok: false, instagram: false });
export const grantPlayerConsent: typeof Native.grantPlayerConsent = async () => {};
export const withdrawPlayerConsent: typeof Native.withdrawPlayerConsent = async () => {};
