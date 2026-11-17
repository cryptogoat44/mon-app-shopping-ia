// Ajouts à la politique de confidentialité propres à une plateforme (lot
// politique du 2026-11-15). Version de l'app iPhone (et des tests) : aucun
// ajout. Les fonctions proposées seulement sur le site sont décrites dans la
// version site de ce fichier (même nom, suffixe .web.ts), que Metro ne prend
// que pour le site : l'app iPhone n'en contient aucune trace (règle 2.5.19
// d'Apple sur les fonctions cachées ou dormantes). Les deux versions exportent
// les mêmes noms ; src/legal/confidentialite.ts et confidentialite.en.ts les
// importent par ce nom neutre (choix par plateforme).
// Hors de src/legal à dessein : chaque fichier de ce dossier part dans l'app
// iPhone, et les tests le vérifient mot à mot.
import type { PrivacyExtra } from "../legal/types";

/** Aucun ajout. */
export const NO_PRIVACY_EXTRA: PrivacyExtra = {
  summary: [],
  sections: [],
  bases: [],
  providers: [],
  transfers: [],
  retention: [],
  rights: [],
  age: [],
};

export const privacyExtraFr: PrivacyExtra = NO_PRIVACY_EXTRA;
export const privacyExtraEn: PrivacyExtra = NO_PRIVACY_EXTRA;
