import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TOAST_BOTTOM, toastBottom } from "../src/lib/toast-placement";

// Message flottant (lib/toast-context.tsx) : un partage reçu pendant une
// saisie ou dans une feuille (« Nouvelle publication ») était dit sous le
// clavier ou sous la feuille, donc invisible (contre-vérification du lot
// « partager vers Spotto »).
describe("place du message flottant", () => {
  it("sans clavier : au-dessus de la barre d'onglets, comme avant", () => {
    expect(toastBottom(0)).toBe(TOAST_BOTTOM);
    expect(TOAST_BOTTOM).toBe(110);
  });

  it("clavier de l'iPhone ouvert (environ 290 à 340 pt) : juste au-dessus du clavier", () => {
    for (const keyboard of [291, 336, 346]) {
      expect(toastBottom(keyboard)).toBeGreaterThan(keyboard);
      expect(toastBottom(keyboard)).toBeLessThanOrEqual(keyboard + 24);
    }
  });

  it("simple barre de clavier (clavier physique branché) ou valeur illisible : rien ne bouge", () => {
    for (const keyboard of [44, -10, Number.NaN]) expect(toastBottom(keyboard)).toBe(TOAST_BOTTOM);
  });
});

describe("message flottant sur l'iPhone", () => {
  const source = readFileSync(join(__dirname, "../src/lib/toast-context.tsx"), "utf8");

  it("dans une couche au-dessus de toute l'app (feuilles comprises), qui ne retient pas VoiceOver", () => {
    expect(source).toMatch(/import \{ FullWindowOverlay \} from "react-native-screens"/);
    // Sans ce réglage, VoiceOver resterait enfermé dans le message tant qu'il est affiché.
    expect(source).toMatch(/<FullWindowOverlay unstable_accessibilityContainerViewIsModal=\{false\}>/);
    // Une couche par message : posée au-dessus de ce qui est ouvert à ce moment-là.
    expect(source).toMatch(/<ToastBubble key=\{toast\.id\}/);
    // VoiceOver lit le message par l'annonce, pas une seconde fois dans la couche.
    expect(source).toMatch(/announceForAccessibility\(text\)/);
    expect(source).toMatch(/accessibilityElementsHidden=\{ios\}/);
  });

  it("suit le clavier tant qu'il est affiché, et accepte une durée pour les messages longs", () => {
    for (const event of ["keyboardWillShow", "keyboardDidShow", "keyboardWillHide", "keyboardDidHide"]) expect(source).toContain(`"${event}"`);
    expect(source).toMatch(/bottom: toastBottom\(keyboardHeight\)/);
    expect(source).toMatch(/options\?\.durationMs \?\? VISIBLE_DURATION_MS/);
  });
});
