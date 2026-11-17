import type { LegalDocumentType } from "@monapp/shared-types";

/** Un paragraphe, ou une liste à puces. */
export type LegalBlock = string | readonly string[];

export interface LegalSection {
  title: string;
  blocks: readonly LegalBlock[];
}

export interface LegalDocument {
  type: LegalDocumentType;
  title: string;
  sections: readonly LegalSection[];
}

/** Ajouts à la politique de confidentialité propres à une plateforme : les
 * fonctions qui n'existent que sur le site y sont décrites, et nulle part
 * ailleurs (src/legal-extra/confidentialite-extra, version site en .web.ts).
 * Chaque liste est ajoutée à la section correspondante ; vide, rien ne change. */
export interface PrivacyExtra {
  /** Puces ajoutées à « En bref ». */
  summary: readonly string[];
  /** Sections insérées après « Alertes prix et stock ». */
  sections: readonly LegalSection[];
  /** Puces ajoutées à « Pourquoi, et sur quelle base ». */
  bases: readonly string[];
  /** Puces ajoutées à la liste des prestataires. */
  providers: readonly string[];
  /** Puces ajoutées à la liste des transferts hors de l'Union européenne. */
  transfers: readonly string[];
  /** Puces ajoutées à « Combien de temps ». */
  retention: readonly string[];
  /** Puces ajoutées à « Vos droits ». */
  rights: readonly string[];
  /** Paragraphes ajoutés à « Âge minimum ». */
  age: readonly string[];
}

/** Repère, dans un texte, les champs laissés au fondateur :
 * « [À compléter : …] », « [À décider : …] », « [À vérifier : …] », et
 * leurs équivalents anglais « [To be completed/decided/verified: …] ». */
export const PLACEHOLDER_PATTERN = /(\[(?:À (?:compléter|décider|vérifier)|To be (?:completed|decided|verified))[^\]]*\])/;
