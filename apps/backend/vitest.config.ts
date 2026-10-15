import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Les tests parlent au vrai Supabase (pas de mock/DB locale) — laisse de
    // la marge pour la latence réseau plutôt que le défaut de 5s. 60 s depuis
    // le 2026-10-15 (décision du fondateur) : spotto-dev, sur l'offre gratuite,
    // a des pics isolés de 0,5 à 4,8 s par requête (mesure-latence-dev), et
    // les machines de GitHub sont deux fois plus loin que le Mac.
    testTimeout: 60_000,
    hookTimeout: 60_000,
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
