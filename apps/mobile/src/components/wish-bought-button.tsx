import { useState } from "react";
import { Pressable, Text } from "react-native";
import * as Haptics from "expo-haptics";
import type { VaultCategory, WishlistItemDetail } from "@monapp/shared-types";
import { color, font, radius, space } from "@/theme/tokens";
import { t } from "@/i18n";
import { addVaultItemFromMatch } from "@/lib/api";
import { useToast } from "@/lib/toast-context";
import { vaultChanged } from "@/lib/vault-changes";
import { ErrorMessage } from "@/components/error-message";
import { VaultCategorySheet } from "@/components/vault-category-sheet";
import { themedStyles } from "@/theme/themed-styles";

/** « Je l'ai achetée » sur la fiche d'une envie (lot « Retrouver ses
 * pièces ») : le chemin naturel est « je garde, puis j'achète quelques jours
 * plus tard ». Même choix de catégorie que dans les résultats ; la pièce entre
 * au Vault depuis la proposition d'origine de l'envie, sans photo — le serveur
 * vérifie qu'elle vient d'une recherche de la personne et reprend son image.
 * Déjà dans le Vault : « Ajoutée au Vault », et jamais de doublon. */
export function WishBoughtButton({
  item,
  onAdded,
}: {
  item: Pick<WishlistItemDetail, "title" | "imageUrl" | "productMatchId" | "inVault">;
  /** La fiche passe à « Ajoutée au Vault » (relue du serveur à chaque retour). */
  onAdded: () => void;
}) {
  const { showToast } = useToast();
  const [choosing, setChoosing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matchId = item.productMatchId;
  // Sans proposition d'origine, rien à ranger sans photo : l'ajout à la main reste dans le Vault.
  if (!matchId) return null;
  const done = item.inVault === true;

  async function handleChoose(category: VaultCategory) {
    setChoosing(false);
    if (!matchId || adding || done) return;
    setAdding(true);
    setError(null);
    try {
      const added = await addVaultItemFromMatch({ title: item.title, imageUrl: item.imageUrl, category, productMatchId: matchId });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      showToast(added.alreadyInVault === true ? t.retrouverPieces.alreadyInVault : t.result.boughtToast);
      vaultChanged();
      onAdded();
    } catch {
      setError(t.result.boughtError);
    } finally {
      setAdding(false);
    }
  }

  return (
    <>
      <Pressable
        style={styles.button}
        onPress={() => setChoosing(true)}
        disabled={done || adding}
        accessibilityRole="button"
        accessibilityState={{ disabled: done || adding, busy: adding }}
      >
        <Text style={[styles.label, done ? styles.labelDone : null]}>{done ? t.result.bought : adding ? t.vaultForm.submitting : t.result.markAsBought}</Text>
      </Pressable>
      {error ? <ErrorMessage style={styles.error}>{error}</ErrorMessage> : null}
      <VaultCategorySheet visible={choosing} onClose={() => setChoosing(false)} onChoose={(category) => void handleChoose(category)} />
    </>
  );
}

const styles = themedStyles(() => ({
  button: { borderWidth: 1, borderColor: color.filet, borderRadius: radius.md, minHeight: 48, alignItems: "center", justifyContent: "center", marginTop: space.sm },
  label: { color: color.vert, fontSize: font.secondary, fontWeight: "600" },
  labelDone: { color: color.acier },
  error: { fontSize: font.caption, marginTop: space.sm, textAlign: "center" },
}));
