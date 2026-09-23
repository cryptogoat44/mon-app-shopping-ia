import { ScrollViewStyleReset } from "expo-router/html";
import { type PropsWithChildren } from "react";

// Page HTML racine du site web (exécutée uniquement à la compilation, jamais
// dans le navigateur). Déclare le site en français : sans ça, les lecteurs
// d'écran lisaient le texte avec une prononciation anglaise (audit Lot Q,
// A11Y-04). Le titre de l'onglet est posé dans le layout racine (<Head>),
// seul endroit que le gestionnaire de titres d'Expo Router respecte.
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <ScrollViewStyleReset />
      </head>
      <body>{children}</body>
    </html>
  );
}
