// Identité de l'éditeur et des hébergeurs, utilisée par les deux documents
// juridiques (une seule source).
//
// Éditeur : le dépôt est PUBLIC — aucune coordonnée personnelle n'est
// écrite ici (règle du fondateur, 2026-09-25). Elles sont lues au moment de
// la construction du site dans des variables d'environnement publiques
// (fichier apps/mobile/.env en local, ignoré par Git ; variables du service
// Render du site en production). Une variable absente ou vide affiche
// « [À compléter : …] » : la page reste lisible, rien ne plante.
// À mettre à jour dès la création d'une structure juridique
// (points-de-vigilance.md).
//
// Hébergeurs : informations publiques, relevées sur leurs pages officielles
// le 2026-09-25 (sources dans docs/journal-decisions.md).

export interface Publisher {
  name: string;
  status: string;
  address: string;
  email: string;
  phone: string;
}

const PLACEHOLDERS: Publisher = {
  name: "[À compléter : nom de l'éditeur]",
  status: "[À compléter : statut de l'éditeur]",
  address: "[À compléter : adresse postale]",
  email: "[À compléter : adresse e-mail de contact]",
  phone: "[À compléter : numéro de téléphone]",
};

/** Complète chaque champ absent ou vide par son « [À compléter : …] ». */
export function readPublisher(values: Partial<Record<keyof Publisher, string | undefined>>): Publisher {
  const pick = (key: keyof Publisher) => values[key]?.trim() || PLACEHOLDERS[key];
  return { name: pick("name"), status: pick("status"), address: pick("address"), email: pick("email"), phone: pick("phone") };
}

// Chaque variable est écrite en entier : Expo ne remplace, à la
// construction, que les accès littéraux « process.env.EXPO_PUBLIC_… ».
export const PUBLISHER = readPublisher({
  name: process.env.EXPO_PUBLIC_PUBLISHER_NAME,
  status: process.env.EXPO_PUBLIC_PUBLISHER_STATUS,
  address: process.env.EXPO_PUBLIC_PUBLISHER_ADDRESS,
  email: process.env.EXPO_PUBLIC_PUBLISHER_EMAIL,
  phone: process.env.EXPO_PUBLIC_PUBLISHER_PHONE,
});

export const HOSTS = {
  // Conditions d'utilisation de Render (render.com/terms), section de l'agent DMCA.
  render: "Render Services, Inc., 525 Brannan Street, Suite 300, San Francisco, CA 94107, États-Unis — téléphone : +1 415 319 8186",
  // Conditions d'utilisation de Supabase (supabase.com/terms). Aucun numéro
  // de téléphone sur ses pages officielles (conditions, confidentialité,
  // contact, société, DPA) : point signalé au juriste.
  supabase:
    "Supabase Pte. Ltd., 65 Chulia Street #38-02/03, OCBC Centre, Singapour 049513 — [À compléter : téléphone, absent des pages officielles de Supabase]",
} as const;
