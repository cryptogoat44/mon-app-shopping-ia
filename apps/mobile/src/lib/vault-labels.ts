import type { PrivacyLevel, VaultCategory } from "@monapp/shared-types";

export const VAULT_CATEGORIES: VaultCategory[] = [
  "clothing",
  "watches",
  "accessories",
  "shoes",
  "bags",
  "home",
  "other",
];

export const VAULT_CATEGORY_LABELS: Record<VaultCategory, string> = {
  clothing: "Vêtements",
  watches: "Montres",
  accessories: "Accessoires",
  shoes: "Chaussures",
  bags: "Sacs",
  home: "Maison",
  other: "Autre",
};

export const PRIVACY_LEVELS: PrivacyLevel[] = ["public", "followers", "private"];

export const PRIVACY_LABELS: Record<PrivacyLevel, string> = {
  public: "Public",
  followers: "Abonnés",
  private: "Privé",
};
