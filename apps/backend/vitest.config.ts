import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Les tests parlent au vrai Supabase (pas de mock/DB locale) — laisse de
    // la marge pour la latence réseau plutôt que le défaut de 5s.
    testTimeout: 20000,
    hookTimeout: 20000,
    // Un seul worker : les tests créent/suppriment des utilisateurs Supabase
    // réels par leur email ; les lancer en parallèle n'apporterait rien ici
    // et compliquerait le nettoyage.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/**/*.ts"],
      exclude: ["src/server.ts"],
    },
  },
});
