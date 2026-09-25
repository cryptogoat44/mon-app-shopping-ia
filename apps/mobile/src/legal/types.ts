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

/** Repère, dans un texte, les champs laissés au fondateur :
 * « [À compléter : …] », « [À décider : …] », « [À vérifier : …] ». */
export const PLACEHOLDER_PATTERN = /(\[À (?:compléter|décider|vérifier)[^\]]*\])/;
