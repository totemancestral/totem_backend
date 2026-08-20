/**
 * Source de vérité unique du catalogue côté backend.
 * Alignée sur totem-project/src/lib/offers.ts (brief 2026-08-06) :
 * Origine 49 €, Révélation/Ancestral 99 €, Famille 219 €, Junior 9,99 €.
 *
 * Les variables TOTEM_PRICE_*_CENTS peuvent surcharger en ops, mais les
 * défauts (env.schema, render.yaml, .env.example) doivent rester ces constantes.
 */
export const TOTEM_PRICES_CENTS = {
  origine: 4900,
  ancestral: 9900,
  famille: 21900,
  junior: 999,
} as const;

export const OFFER_LABELS = {
  origine: "TOTEM ANCESTRAL - Origine",
  ancestral: "TOTEM ANCESTRAL - Revelation",
  famille: "TOTEM ANCESTRAL - Famille",
  junior: "TOTEM JUNIOR",
} as const;
