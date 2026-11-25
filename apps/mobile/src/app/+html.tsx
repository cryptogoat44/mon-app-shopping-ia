import { ScrollViewStyleReset } from "expo-router/html";
import { type PropsWithChildren } from "react";

// Anneau de focus du clavier (lot « couleurs et logo ») : avec « Noir et
// ivoire », l'anneau par défaut de Chrome et d'Edge (presque noir en clair,
// presque blanc en sombre) se confondait avec les boutons pleins et les puces
// choisies. Un trait de 2 px décalé de 2 px, en CanvasText, et sous lui une
// bande de 2 px en Canvas (box-shadow) qui comble l'écart : l'anneau a deux
// tons, comme celui de Chrome. Sur le fond de la page, le trait se voit ; dans
// un conteneur plein (la bulle de mes messages, remplie à l'accent : encre en
// clair, ivoire en sombre), c'est la bande qui se voit, autour d'une
// publication partagée par exemple. CanvasText et Canvas suivent le thème posé
// sur <html> par preferences-context (style.colorScheme) : noir sur blanc en
// clair, blanc sur presque noir en sombre, même quand le membre a choisi un
// thème différent de celui de son appareil. Ce ne sont pas des couleurs en
// dur, ce sont les couleurs de texte et de fond du navigateur pour ce thème.
const ANNEAU_DE_FOCUS = ":focus-visible{outline:2px solid CanvasText;outline-offset:2px;box-shadow:0 0 0 2px Canvas}";

// Page HTML racine du site web (exécutée uniquement à la compilation, jamais
// dans le navigateur). Déclare le site en français : sans ça, les lecteurs
// d'écran lisaient le texte avec une prononciation anglaise (audit Lot Q,
// A11Y-04). Le titre de l'onglet est posé dans le layout racine (<WebTitle>),
// seul endroit que le gestionnaire de titres d'Expo Router respecte.
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <ScrollViewStyleReset />
        <style>{ANNEAU_DE_FOCUS}</style>
      </head>
      <body>{children}</body>
    </html>
  );
}
