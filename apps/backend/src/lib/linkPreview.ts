// Interrupteur des liens TikTok et Instagram (lot « nettoyage avant le premier
// build », 2026-11-10) : le seul endroit qui lit LINK_PREVIEW_ENABLED
// (src/env.ts). Coupé par défaut ; seule la valeur exacte "true" l'allume. Il
// n'est pas dans la liste des variables que les outils peuvent changer
// (scripts/lib/render-guard.ts, EDITABLE_VARIABLES) : le fondateur seul
// l'allume, à la main, dans le tableau de bord de Render.
//
// Pourquoi : l'app n'envoie plus de lien depuis le 7 octobre 2026
// (LINK_COVER_ENABLED, apps/mobile/src/lib/spot-flags.ts), mais le serveur,
// lui, acceptait encore un lien de n'importe quel compte connecté (ancienne
// version de l'app, requête fabriquée à la main) : il appelait alors TikTok ou
// Meta, enregistrait le lien et l'adresse de la couverture, puis envoyait cette
// couverture à la recherche visuelle. Aucune plateforme n'a autorisé cet usage
// par écrit.
//
// Coupé, trois gardes, au plus près de chaque geste :
// - « préparer » (routes/searches.ts) ignore le lien : la recherche est créée
//   comme pour une photo, rien du lien n'est enregistré ;
// - fetchOfficialPreview (services/oembed.ts) n'appelle ni TikTok ni Meta,
//   d'où qu'on l'appelle ;
// - « lancer » (routes/searches.ts, prepareRunImage) ne télécharge jamais une
//   couverture enregistrée avant la coupure.
// Allumé : le comportement d'avant ce lot, inchangé.
import { env } from "../env.js";

/** Le serveur peut-il aller chercher la couverture d'un lien TikTok ou
 * Instagram, l'enregistrer et s'en servir au lancement ? */
export function linkPreviewEnabled(): boolean {
  return env.LINK_PREVIEW_ENABLED;
}
