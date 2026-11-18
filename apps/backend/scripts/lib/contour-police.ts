// Contour d'une lettre, lu dans un fichier de police TrueType (.ttf) : le
// tracé vectoriel que scripts/images-marque.ts dessine pour le logo. La lettre
// vient ainsi du fichier de police du dépôt (assets/fonts/), jamais d'une
// police installée sur la machine ni d'un tracé recopié à la main.
// Sans dépendance : seules les tables utiles du fichier sont lues (head, maxp,
// cmap, loca, glyf). Limites voulues, dites par une erreur claire : police aux
// contours TrueType, lettre simple (pas une lettre accentuée, composée de
// deux dessins), caractère courant (plan de base d'Unicode).

export interface ContourLettre {
  /** Tracé SVG (M, L, Q, Z) en unités de la police, axe vertical vers le HAUT. */
  trace: string;
  /** Bornes du dessin déclarées par la police, débordements compris. */
  bornes: { x0: number; y0: number; x1: number; y1: number };
  /** Unités de la police par cadratin (taille du texte). */
  unitesParCadratin: number;
}

interface Point {
  x: number;
  y: number;
  /** Sur la courbe (vrai), ou point de contrôle d'une courbe (faux). */
  surCourbe: boolean;
}

/** Emplacement de chaque table du fichier, par son nom de quatre lettres. */
function tables(police: Buffer): Map<string, number> {
  if (police.length < 12 || police.readUInt32BE(0) !== 0x00010000) {
    throw new Error("Police non gérée : il faut un fichier TrueType (.ttf) aux contours TrueType.");
  }
  const places = new Map<string, number>();
  for (let i = 0; i < police.readUInt16BE(4); i++) {
    const entree = 12 + i * 16;
    places.set(police.toString("latin1", entree, entree + 4), police.readUInt32BE(entree + 8));
  }
  return places;
}

/** Numéro du dessin d'un caractère (table « cmap », format 4) ; 0 : absent de la police. */
function numeroDuDessin(police: Buffer, cmap: number, code: number): number {
  let table: number | null = null;
  for (let i = 0; i < police.readUInt16BE(cmap + 2); i++) {
    const entree = cmap + 4 + i * 8;
    const plateforme = police.readUInt16BE(entree);
    const encodage = police.readUInt16BE(entree + 2);
    const place = cmap + police.readUInt32BE(entree + 4);
    // Unicode, plan de base : Windows (3, 1) ou Unicode (0, n), au format 4.
    if (((plateforme === 3 && encodage === 1) || plateforme === 0) && police.readUInt16BE(place) === 4) table = place;
  }
  if (table === null) throw new Error("Police non gérée : table des caractères (cmap) sans format 4.");
  const taille = police.readUInt16BE(table + 6); // deux fois le nombre de segments
  const fins = table + 14;
  const debuts = fins + taille + 2;
  const decalages = debuts + taille;
  const renvois = decalages + taille;
  for (let i = 0; i < taille; i += 2) {
    if (code > police.readUInt16BE(fins + i)) continue;
    const debut = police.readUInt16BE(debuts + i);
    if (code < debut) return 0;
    const decalage = police.readInt16BE(decalages + i);
    const renvoi = police.readUInt16BE(renvois + i);
    if (renvoi === 0) return (code + decalage) & 0xffff;
    const numero = police.readUInt16BE(renvois + i + renvoi + (code - debut) * 2);
    return numero === 0 ? 0 : (numero + decalage) & 0xffff;
  }
  return 0;
}

/** Nombre sans zéros inutiles (« 12 », « 12.5 »). */
const nombre = (valeur: number) => String(Math.round(valeur * 100) / 100);

/** Un contour fermé de la police, en commandes SVG. Deux points de contrôle
 * qui se suivent sous-entendent un point de la courbe, à mi-chemin (règle du
 * format TrueType). */
function traceDuContour(points: Point[]): string {
  const milieu = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, surCourbe: true });
  const premier = points[0]!;
  const dernier = points[points.length - 1]!;
  // Départ sur la courbe : le premier point, sinon le dernier, sinon leur milieu.
  const depart = premier.surCourbe ? premier : dernier.surCourbe ? dernier : milieu(dernier, premier);
  const suite = premier.surCourbe ? [...points.slice(1), premier] : dernier.surCourbe ? points : [...points, depart];
  const commandes = [`M${nombre(depart.x)} ${nombre(depart.y)}`];
  let controle: Point | null = null;
  for (const point of suite) {
    if (point.surCourbe) {
      commandes.push(controle ? `Q${nombre(controle.x)} ${nombre(controle.y)} ${nombre(point.x)} ${nombre(point.y)}` : `L${nombre(point.x)} ${nombre(point.y)}`);
      controle = null;
    } else {
      if (controle) {
        const sousEntendu = milieu(controle, point);
        commandes.push(`Q${nombre(controle.x)} ${nombre(controle.y)} ${nombre(sousEntendu.x)} ${nombre(sousEntendu.y)}`);
      }
      controle = point;
    }
  }
  if (controle) commandes.push(`Q${nombre(controle.x)} ${nombre(controle.y)} ${nombre(depart.x)} ${nombre(depart.y)}`);
  return `${commandes.join(" ")} Z`;
}

/** Le contour de `lettre` (un seul caractère) dans le fichier de police `police`. */
export function contourLettre(police: Buffer, lettre: string): ContourLettre {
  const code = lettre.codePointAt(0);
  if (code === undefined || [...lettre].length !== 1 || code > 0xffff) throw new Error("Un seul caractère courant est attendu.");
  const places = tables(police);
  const table = (nom: string): number => {
    const place = places.get(nom);
    if (place === undefined) throw new Error(`Police non gérée : table « ${nom} » absente.`);
    return place;
  };
  const head = table("head");
  const numero = numeroDuDessin(police, table("cmap"), code);
  if (numero === 0 || numero >= police.readUInt16BE(table("maxp") + 4)) throw new Error(`La police ne contient pas le caractère « ${lettre} ».`);

  // Table « loca » : où commence chaque dessin dans la table « glyf ».
  const placesLongues = police.readInt16BE(head + 50) === 1;
  const loca = table("loca");
  const place = (n: number) => (placesLongues ? police.readUInt32BE(loca + n * 4) : police.readUInt16BE(loca + n * 2) * 2);
  const debut = table("glyf") + place(numero);
  if (place(numero) === place(numero + 1)) throw new Error(`Le caractère « ${lettre} » n'a pas de dessin (espace ?).`);
  const contours = police.readInt16BE(debut);
  if (contours <= 0) throw new Error(`Le caractère « ${lettre} » est composé de plusieurs dessins : non géré.`);

  let position = debut + 10;
  const fins: number[] = [];
  for (let i = 0; i < contours; i++) fins.push(police.readUInt16BE(position + i * 2));
  position += contours * 2;
  position += 2 + police.readUInt16BE(position); // instructions d'affichage à petite taille : ignorées
  const total = fins[fins.length - 1]! + 1;

  // Un octet de réglages par point (répété si le bit 8 est mis).
  const reglages: number[] = [];
  while (reglages.length < total) {
    const reglage = police[position++]!;
    reglages.push(reglage);
    if (reglage & 8) for (let repetitions = police[position++]!; repetitions > 0; repetitions--) reglages.push(reglage);
  }
  // Coordonnées : chacune est l'écart avec la précédente, sur un ou deux octets.
  const coordonnees = (court: number, memeOuPositif: number): number[] => {
    const valeurs: number[] = [];
    let valeur = 0;
    for (const reglage of reglages.slice(0, total)) {
      if (reglage & court) {
        const ecart = police[position++]!;
        valeur += reglage & memeOuPositif ? ecart : -ecart;
      } else if (!(reglage & memeOuPositif)) {
        valeur += police.readInt16BE(position);
        position += 2;
      }
      valeurs.push(valeur);
    }
    return valeurs;
  };
  const xs = coordonnees(2, 16);
  const ys = coordonnees(4, 32);

  const traces: string[] = [];
  let premier = 0;
  for (const fin of fins) {
    const points: Point[] = [];
    for (let i = premier; i <= fin; i++) points.push({ x: xs[i]!, y: ys[i]!, surCourbe: (reglages[i]! & 1) === 1 });
    traces.push(traceDuContour(points));
    premier = fin + 1;
  }
  return {
    trace: traces.join(" "),
    bornes: { x0: police.readInt16BE(debut + 2), y0: police.readInt16BE(debut + 4), x1: police.readInt16BE(debut + 6), y1: police.readInt16BE(debut + 8) },
    unitesParCadratin: police.readUInt16BE(head + 18),
  };
}
