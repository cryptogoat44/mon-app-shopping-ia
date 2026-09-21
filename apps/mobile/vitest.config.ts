import { defineConfig } from "vitest/config";

// Couvre uniquement la logique pure/DOM-légère du dossier lib (ex.
// merchant-links.ts) — pas de rendu de composants React Native ici, ça
// demanderait un harnais bien plus lourd (jest-expo). `window` est stubbé
// directement dans les tests plutôt que via un environnement DOM complet.
export default defineConfig({
  test: {
    environment: "node",
  },
});
