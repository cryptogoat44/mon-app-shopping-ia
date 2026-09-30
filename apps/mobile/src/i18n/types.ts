import type { fr } from "./fr";

// Forme d'un catalogue : celle du catalogue français, avec des textes libres
// (le français est écrit « as const » ; l'anglais doit seulement avoir les
// mêmes clés et les mêmes fonctions).
type Widen<T> = T extends string
  ? string
  : T extends (...args: infer A) => infer R
    ? (...args: A) => Widen<R>
    : T extends readonly (infer U)[]
      ? readonly Widen<U>[]
      : { readonly [K in keyof T]: Widen<T[K]> };

export type Catalog = Widen<typeof fr>;
