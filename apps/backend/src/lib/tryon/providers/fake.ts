// Faux fournisseur d'essayage (lot « essayage virtuel ») : un vrai composant,
// réservé au développement et aux tests (refusé en production :
// lib/tryon/config.ts). Aucun appel réseau, aucun coût : il renvoie la photo
// du membre telle quelle, avec un bandeau rouge bien visible
// « TEST – FAUX ESSAI » en haut (le serveur ajoute ensuite, comme pour le
// vrai, le bandeau « Image générée par IA » en bas). Il annonce 1 crédit par
// essai, pour essayer quotas et budget en développement comme en vrai.
// Les tests règlent son solde et ses échecs par son constructeur, jamais
// par une variable d'environnement.
import type { Locale } from "../../locale.js";
import { drawBand, type BandStyle } from "../band.js";
import { TryonProviderError, type TryOnProvider, type TryonProviderErrorKind, type TryonRunInput, type TryonRunOutput } from "../provider.js";

const FAKE_BAND_STYLE: BandStyle = { placement: "top", background: { r: 179, g: 38, b: 30, alpha: 0.92 } };

/** Texte du bandeau du faux essai. */
export function fakeBandText(locale: Locale): string {
  return locale === "en" ? "TEST – FAKE TRY-ON" : "TEST – FAUX ESSAI";
}

export interface FakeProviderOptions {
  /** Solde de crédits annoncé (1 000 par défaut). */
  balance?: number;
  /** Solde illisible : cette erreur à chaque lecture. */
  balanceFailure?: TryonProviderErrorKind;
  /** Chaque essai échoue avec cette erreur (silhouette introuvable, modération…). */
  failure?: TryonProviderErrorKind;
  /** L'image de la pièce donnée par son adresse « ne se charge pas »
   * (ImageLoadError de FASHN) : le serveur doit alors envoyer ses octets. */
  garmentUrlUnreadable?: boolean;
}

export class FakeProvider implements TryOnProvider {
  readonly name = "fake" as const;
  /** Comment l'image de la pièce a été reçue, essai après essai (jamais l'image). */
  readonly garmentKinds: ("url" | "data")[] = [];
  private readonly options: FakeProviderOptions;

  constructor(options: FakeProviderOptions = {}) {
    this.options = options;
  }

  async run(input: TryonRunInput): Promise<TryonRunOutput> {
    this.garmentKinds.push(input.garmentImage.kind);
    if (this.options.failure) throw new TryonProviderError(this.options.failure);
    if (input.garmentImage.kind === "url" && this.options.garmentUrlUnreadable) throw new TryonProviderError("image_load");
    const image = await drawBand(input.personImage, fakeBandText(input.locale), FAKE_BAND_STYLE);
    return { image, creditsUsed: 1 };
  }

  async getCreditBalance(): Promise<number> {
    if (this.options.balanceFailure) throw new TryonProviderError(this.options.balanceFailure);
    return this.options.balance ?? 1000;
  }
}
