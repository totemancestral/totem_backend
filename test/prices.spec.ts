import { describe, it, expect } from "vitest";
import { TOTEM_PRICES_CENTS, OFFER_LABELS } from "../src/totem/prices";

describe("catalogue prix", () => {
  it("aligne le brief 2026-08-06 (49 / 99 / 219 / 9,99)", () => {
    expect(TOTEM_PRICES_CENTS.origine).toBe(4900);
    expect(TOTEM_PRICES_CENTS.ancestral).toBe(9900);
    expect(TOTEM_PRICES_CENTS.famille).toBe(21900);
    expect(TOTEM_PRICES_CENTS.junior).toBe(999);
  });

  it("expose les libellés Stripe price_data", () => {
    expect(OFFER_LABELS.ancestral).toBe("TOTEM ANCESTRAL - Revelation");
    expect(OFFER_LABELS.junior).toBe("TOTEM JUNIOR");
  });
});
