/**
 * Source de vérité unique du catalogue côté backend.
 * Origine 29,72 €, Révélation/Ancestral 38,40 €, Junior 9,99 €.
 * Le tarif Famille est conservé pour la lecture des commandes historiques.
 */
export const TOTEM_PRICES_CENTS = {
  origine: 2972,
  ancestral: 3840,
  famille: 21900,
  junior: 999,
} as const;

export const OFFER_LABELS = {
  origine: "TOTEM ANCESTRAL - Origine",
  ancestral: "TOTEM ANCESTRAL - Revelation",
  famille: "TOTEM ANCESTRAL - Famille",
  junior: "TOTEM JUNIOR",
} as const;
