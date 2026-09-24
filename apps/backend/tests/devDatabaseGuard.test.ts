import { describe, expect, it } from "vitest";
import { assertDevDatabaseUrl, assertDevSupabaseUrl } from "../scripts/lib/dev-database.js";

// Le script de migration automatique ne doit JAMAIS pouvoir viser la
// production (décision du fondateur, 2026-09-24).
describe("garde-fou des migrations de spotto-dev", () => {
  const DEV_POOLER = "postgresql://postgres.sbtwsmxfdfxzgcohbznd:motdepasse@aws-0-eu-west-3.pooler.supabase.com:5432/postgres";
  const DEV_DIRECT = "postgresql://postgres:motdepasse@db.sbtwsmxfdfxzgcohbznd.supabase.co:5432/postgres";

  it("accepte les deux formes d'adresse de spotto-dev", () => {
    expect(assertDevDatabaseUrl(DEV_POOLER).hostname).toContain("pooler.supabase.com");
    expect(assertDevDatabaseUrl(DEV_DIRECT).hostname).toBe("db.sbtwsmxfdfxzgcohbznd.supabase.co");
  });

  it("refuse toute adresse de production, sous toutes ses formes", () => {
    for (const url of [
      "postgresql://postgres.qcwnlqkxnhqpyjpkooiw:mdp@aws-0-eu-west-3.pooler.supabase.com:5432/postgres",
      "postgresql://postgres:mdp@db.qcwnlqkxnhqpyjpkooiw.supabase.co:5432/postgres",
      // Piège : identifiant de dev glissé ailleurs, mais base de production.
      "postgresql://postgres.qcwnlqkxnhqpyjpkooiw:sbtwsmxfdfxzgcohbznd@aws-0-eu-west-3.pooler.supabase.com:5432/postgres",
    ]) {
      expect(() => assertDevDatabaseUrl(url)).toThrow(/PRODUCTION/);
    }
  });

  it("refuse une adresse qui ne désigne pas spotto-dev, même si elle contient son identifiant", () => {
    expect(() => assertDevDatabaseUrl("postgresql://postgres:mdp@autre-serveur.example.com:5432/sbtwsmxfdfxzgcohbznd")).toThrow(/ne désigne pas spotto-dev/);
    expect(() => assertDevDatabaseUrl("postgresql://postgres:mdp@localhost:5432/postgres")).toThrow(/ne désigne pas spotto-dev/);
  });

  it("refuse une adresse absente, illisible, sans mot de passe ou non Postgres", () => {
    expect(() => assertDevDatabaseUrl(undefined)).toThrow(/absente/);
    expect(() => assertDevDatabaseUrl("n'importe quoi")).toThrow(/illisible/);
    expect(() => assertDevDatabaseUrl("postgresql://postgres.sbtwsmxfdfxzgcohbznd:[YOUR-PASSWORD]@aws-0.pooler.supabase.com:5432/postgres")).toThrow(/mot de passe/);
    expect(() => assertDevDatabaseUrl("https://sbtwsmxfdfxzgcohbznd.supabase.co")).toThrow(/Postgres/);
  });

  it("adresse du projet Supabase (parcours à l'écran) : spotto-dev seulement", () => {
    expect(assertDevSupabaseUrl("https://sbtwsmxfdfxzgcohbznd.supabase.co", "test").hostname).toBe("sbtwsmxfdfxzgcohbznd.supabase.co");
    expect(() => assertDevSupabaseUrl("https://qcwnlqkxnhqpyjpkooiw.supabase.co", "test")).toThrow(/PRODUCTION/);
    expect(() => assertDevSupabaseUrl("https://autre.supabase.co/sbtwsmxfdfxzgcohbznd", "test")).toThrow(/ne désigne pas spotto-dev/);
    expect(() => assertDevSupabaseUrl(undefined, "test")).toThrow(/absente/);
  });
});
