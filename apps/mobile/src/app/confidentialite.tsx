import { LegalDocumentView } from "@/components/legal-document-view";
import { privacyPolicy } from "@/legal/confidentialite";
import { privacyPolicyEn } from "@/legal/confidentialite.en";
import { getActiveLocale } from "@/i18n";

// Politique de confidentialité : lisible connecté ou non (hors des groupes
// protégés du layout racine) — adresse publique « /confidentialite ».
export default function PrivacyPolicyScreen() {
  return <LegalDocumentView document={getActiveLocale() === "en" ? privacyPolicyEn : privacyPolicy} />;
}
