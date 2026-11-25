import { Platform, type SwitchProps, type TextStyle } from "react-native";
import { color } from "./tokens";

// Lot « couleurs et logo » (« Noir et ivoire », 25 novembre 2026) : l'accent
// a maintenant la couleur du texte. Deux conséquences, réglées ici une fois
// pour toute l'app.

/** Un texte qui est un lien (texte seul, cliquable, sans fond ni bordure de
 * bouton) ne se distingue plus par sa couleur : il est souligné, d'un trait
 * fin. À ajouter (`...lienSouligne`) au style de chaque lien ; jamais au
 * libellé d'un bouton plein ou encadré, ni à une action posée dans la barre
 * de titre d'un écran ou l'en-tête d'une feuille (« Publier », « Fermer ») :
 * reconnue à sa place, comme partout sur iPhone, elle reste en demi-gras,
 * sans trait (tests/couleurs-et-logo.test.ts, ACTIONS_DE_BARRE). Sur iPhone, le trait est celui
 * d'iOS (fin, sous les lettres : son épaisseur et son écart ne se règlent
 * pas) ; sur le site, un trait d'un pixel, décalé de 3 pixels sous le texte. */
export const lienSouligne: TextStyle = {
  textDecorationLine: "underline",
  // Propriétés CSS du navigateur, transmises telles quelles par react-native-web ; inconnues de React Native.
  ...(Platform.OS === "web" ? ({ textUnderlineOffset: 3, textDecorationThickness: 1 } as TextStyle) : null),
};

/** Couleurs d'un interrupteur. Allumé, la piste prend l'accent : ivoire en
 * sombre, où le curseur blanc d'iOS ne se verrait plus (1,1:1) ; le curseur
 * prend alors `blanc` du thème (brun très profond en sombre, blanc en clair :
 * 16,6:1 et 16,8:1 sur la piste). Éteint, le curseur reste blanc (`surImage`,
 * blanc dans les deux thèmes, comme le curseur d'iOS). Sur le site,
 * react-native-web peint le curseur allumé avec `activeThumbColor` (un vert
 * d'eau par défaut) : il reçoit la même couleur. */
export function couleursInterrupteur(allume: boolean): Pick<SwitchProps, "trackColor" | "thumbColor"> {
  const curseur = allume ? color.blanc : color.surImage;
  return {
    trackColor: { true: color.vert, false: color.filet },
    thumbColor: curseur,
    ...(Platform.OS === "web" ? ({ activeThumbColor: color.blanc } as Pick<SwitchProps, "thumbColor">) : null),
  };
}
