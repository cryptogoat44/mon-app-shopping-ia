import { describe, expect, it } from "vitest";
import { assertDevDatabaseUrl, assertDevSupabaseUrl, POOLER_HOST } from "../scripts/lib/dev-database.js";

// Les outils de développement ne doivent JAMAIS pouvoir viser la production
// (décision du fondateur, 2026-09-24) ; depuis le lot outils du 30 octobre
// 2026, ils visent spotto-dev-2, et l'ancien spotto-dev (inaccessible) est refusé.
describe("garde-fou des outils de spotto-dev-2", () => {
  const DEV_POOLER = "postgresql://postgres.sedfepcpmhilaxbrgdif:motdepasse@aws-0-eu-central-1.pooler.supabase.com:5432/postgres";
  const DEV_DIRECT = "postgresql://postgres:motdepasse@db.sedfepcpmhilaxbrgdif.supabase.co:5432/postgres";

  it("accepte les deux formes d'adresse de spotto-dev-2", () => {
    expect(assertDevDatabaseUrl(DEV_POOLER).hostname).toContain("pooler.supabase.com");
    expect(assertDevDatabaseUrl(DEV_DIRECT).hostname).toBe("db.sedfepcpmhilaxbrgdif.supabase.co");
  });

  it("refuse la production (spotto-prod) et l'ancienne production, sous toutes leurs formes", () => {
    for (const url of [
      "postgresql://postgres.selhqdqfrflsqivgxypf:mdp@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
      "postgresql://postgres:mdp@db.selhqdqfrflsqivgxypf.supabase.co:5432/postgres",
      "postgresql://postgres.qcwnlqkxnhqpyjpkooiw:mdp@aws-0-eu-west-3.pooler.supabase.com:5432/postgres",
      "postgresql://postgres:mdp@db.qcwnlqkxnhqpyjpkooiw.supabase.co:5432/postgres",
      // Piège : identifiant de dev glissé ailleurs, mais base de production.
      "postgresql://postgres.selhqdqfrflsqivgxypf:sedfepcpmhilaxbrgdif@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
    ]) {
      expect(() => assertDevDatabaseUrl(url)).toThrow(/PRODUCTION/);
    }
  });

  it("refuse l'ancien spotto-dev, inaccessible, même glissé dans une adresse de spotto-dev-2", () => {
    expect(() => assertDevDatabaseUrl("postgresql://postgres.sbtwsmxfdfxzgcohbznd:mdp@aws-1-eu-west-1.pooler.supabase.com:5432/postgres")).toThrow(/ancien spotto-dev/);
    expect(() => assertDevDatabaseUrl("postgresql://postgres.sedfepcpmhilaxbrgdif:sbtwsmxfdfxzgcohbznd@aws-0-eu-central-1.pooler.supabase.com:5432/postgres")).toThrow(/ancien spotto-dev/);
    expect(() => assertDevSupabaseUrl("https://sbtwsmxfdfxzgcohbznd.supabase.co", "test")).toThrow(/ancien spotto-dev/);
  });

  it("refuse une adresse qui ne désigne pas spotto-dev-2, même si elle contient son identifiant", () => {
    expect(() => assertDevDatabaseUrl("postgresql://postgres:mdp@autre-serveur.example.com:5432/sedfepcpmhilaxbrgdif")).toThrow(/ne désigne pas spotto-dev-2/);
    expect(() => assertDevDatabaseUrl("postgresql://postgres:mdp@localhost:5432/postgres")).toThrow(/ne désigne pas spotto-dev-2/);
  });

  it("refuse une adresse absente, illisible, sans mot de passe ou non Postgres", () => {
    expect(() => assertDevDatabaseUrl(undefined)).toThrow(/absente/);
    expect(() => assertDevDatabaseUrl("n'importe quoi")).toThrow(/illisible/);
    expect(() => assertDevDatabaseUrl("postgresql://postgres.sedfepcpmhilaxbrgdif:[YOUR-PASSWORD]@aws-0.pooler.supabase.com:5432/postgres")).toThrow(/mot de passe/);
    expect(() => assertDevDatabaseUrl("https://sedfepcpmhilaxbrgdif.supabase.co")).toThrow(/Postgres/);
  });

  it("serveur du « Session pooler » demandé par configurer-base-dev : seulement la forme de Supabase", () => {
    expect(["aws-0-eu-central-1.pooler.supabase.com", "aws-1-eu-west-1.pooler.supabase.com"].every((h) => POOLER_HOST.test(h))).toBe(true);
    for (const h of ["pooler.supabase.com", "aws-0-eu-central-1.pooler.supabase.com.exemple.net", "evil.com/aws-0-eu-central-1.pooler.supabase.com", "postgres://x@aws-0-eu-central-1.pooler.supabase.com"]) {
      expect(POOLER_HOST.test(h)).toBe(false);
    }
  });

  it("adresse du projet Supabase (parcours à l'écran) : spotto-dev-2 seulement", () => {
    expect(assertDevSupabaseUrl("https://sedfepcpmhilaxbrgdif.supabase.co", "test").hostname).toBe("sedfepcpmhilaxbrgdif.supabase.co");
    expect(() => assertDevSupabaseUrl("https://selhqdqfrflsqivgxypf.supabase.co", "test")).toThrow(/PRODUCTION/);
    expect(() => assertDevSupabaseUrl("https://qcwnlqkxnhqpyjpkooiw.supabase.co", "test")).toThrow(/PRODUCTION/);
    expect(() => assertDevSupabaseUrl("https://autre.supabase.co/sedfepcpmhilaxbrgdif", "test")).toThrow(/ne désigne pas spotto-dev-2/);
    expect(() => assertDevSupabaseUrl(undefined, "test")).toThrow(/absente/);
  });
});
