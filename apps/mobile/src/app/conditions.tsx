import { LegalDocumentView } from "@/components/legal-document-view";
import { termsOfUse } from "@/legal/conditions";

// Conditions d'utilisation : lisibles connecté ou non (hors des groupes
// protégés du layout racine) — adresse publique « /conditions ».
export default function TermsScreen() {
  return <LegalDocumentView document={termsOfUse} />;
}
