import { describe, it, expect } from "vitest";
import { TOTEM_PRICES_CENTS, OFFER_LABELS } from "../src/totem/prices";

describe("catalogue prix", () => {
  it("aligne Origine à 29,72 € et Révélation à 38,40 €, avec lecture des anciens tarifs Famille", () => {
    expect(TOTEM_PRICES_CENTS.origine).toBe(2972);
    expect(TOTEM_PRICES_CENTS.ancestral).toBe(3840);
    expect(TOTEM_PRICES_CENTS.famille).toBe(21900);
    expect(TOTEM_PRICES_CENTS.junior).toBe(999);
  });

  it("expose les libellés Stripe price_data", () => {
    expect(OFFER_LABELS.ancestral).toBe("TOTEM ANCESTRAL - Revelation");
    expect(OFFER_LABELS.junior).toBe("TOTEM JUNIOR");
  });
});
