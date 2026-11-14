// Site : « Essayer » (essayage virtuel photo) sur une fiche de pièce,
// seulement quand le serveur dit la fonction ouverte (GET /api/tryon/status,
// enabled: true) et que la pièce s'y prête (une proposition du Spotter, une
// image, un lien d'achat). L'essayage s'ouvre dans une fenêtre par-dessus la
// fiche (components/tryon-sheet.web.tsx). Version iPhone : rien
// (piece-extra-actions.tsx), règle 2.5.19 d'Apple.
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { color, font, radius, space } from "@/theme/tokens";
import { themedStyles } from "@/theme/themed-styles";
import { tryonText } from "@/i18n/tryon.web";
import { entryItemId } from "@/lib/tryon-flow.web";
import { useTryonStatus } from "@/lib/use-tryon-status.web";
import type { PieceExtraActionsProps } from "./piece-extra-actions";
import { TryonSheet } from "./tryon-sheet.web";

export function PieceExtraActions({ matchId, imageUrls, buyUrl, title, style }: PieceExtraActionsProps) {
  const status = useTryonStatus();
  // La pièce de la fenêtre ouverte : elle reste ouverte même si le statut
  // change entre-temps (elle dit alors elle-même « indisponible »).
  const [openFor, setOpenFor] = useState<string | null>(null);
  const itemId = entryItemId(status, { matchId, imageUrls, buyUrl });
  if (!itemId && !openFor) return null;
  return (
    <>
      {itemId ? (
        <View style={style}>
          <Pressable
            style={styles.button}
            onPress={() => setOpenFor(itemId)}
            accessibilityRole="button"
            accessibilityLabel={tryonText.entry.buttonLabel(title)}
            testID="essayer-la-piece"
          >
            <Text style={styles.label}>{tryonText.entry.button}</Text>
          </Pressable>
        </View>
      ) : null}
      {openFor ? <TryonSheet itemId={openFor} title={title} onClose={() => setOpenFor(null)} /> : null}
    </>
  );
}

const styles = themedStyles(() => ({
  button: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: space.md },
  label: { color: color.vert, fontSize: font.secondary, fontWeight: "600" },
}));
