import { describe, it, expect } from "vitest";
import { parseCheckoutMetadata } from "../src/totem/totem.schemas";

const q10 = Object.fromEntries(
  Array.from({ length: 10 }, (_, i) => [`q${i + 1}`, `rep-${i + 1}`]),
);

describe("parseCheckoutMetadata", () => {
  it("parse des metadonnees valides avec q1..q10", () => {
    const md = parseCheckoutMetadata({
      userId: "u1",
      offer: "ancestral",
      email: "a@b.co",
      ...q10,
    });
    expect(md.userId).toBe("u1");
    expect(md.offer).toBe("ancestral");
    expect(md.email).toBe("a@b.co");
    expect(md.answers).toHaveLength(10);
    expect(md.answers[0]).toEqual({ questionId: "q1", answer: "rep-1" });
  });

  it("accepte l'alias 'offre' et un tableau answers JSON compact", () => {
    const md = parseCheckoutMetadata({
      userId: "u1",
      offre: "junior",
      answers: JSON.stringify(["x", "y", "z", "w", "v"]),
    });
    expect(md.offer).toBe("junior");
    expect(md.answers).toHaveLength(5);
    expect(md.answers[0]).toEqual({ questionId: "q1", answer: "x" });
  });

  it("utilise l'email de fallback si absent des metadonnees", () => {
    const md = parseCheckoutMetadata({ userId: "u1", ...q10 }, "fallback@x.co");
    expect(md.email).toBe("fallback@x.co");
  });

  it("prend externalCommandId ou l'alias commande_id", () => {
    const md = parseCheckoutMetadata({ userId: "u1", commande_id: "cmd-42", ...q10 });
    expect(md.externalCommandId).toBe("cmd-42");
  });

  it("rejette des metadonnees sans userId", () => {
    expect(() => parseCheckoutMetadata({ ...q10 })).toThrow();
  });
});
