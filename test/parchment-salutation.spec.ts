import { describe, expect, it } from "vitest";
import { correctClientSalutation, buildAdultV3Context, normalizeAdultV3RecitResult } from "../src/totem/totem-v3-pipeline";

describe("parchment client address", () => {
  it.each([
    ["femme", "Cher Fils Lea, reçois ce nom.", "Chère fille Lea, reçois ce nom."],
    ["homme", "Chere Fille Alex, reçois ce nom.", "Cher fils Alex, reçois ce nom."],
    [null, "Cher fils Alex, reçois ce nom.", "Alex, reçois ce nom."],
  ] as const)("uses declared gender %s", (gender, text, expected) => {
    expect(correctClientSalutation(text, { gender, language: "fr" })).toBe(expected);
  });
  it("keeps narration and parchment consistent", () => {
    const context = buildAdultV3Context({ orderId: "test", customerName: "Lea", locale: "fr", answers: [{ questionId: "sexe", answer: "femme" }] });
    const result = normalizeAdultV3RecitResult({ a2: { parchment_text: "Cher fils Lea", transmission: "Cher fils Lea" } }, context);
    expect(result.parchmentText).toBe("Chère fille Lea");
    expect(result.audioMessage).toContain("Chère fille Lea");
  });
  it("preserves French accents in the fallback", () => {
    const context = buildAdultV3Context({ orderId: "test", locale: "fr", answers: [] });
    const text = normalizeAdultV3RecitResult({}, context).parchmentText;
    expect(text).toContain("ancêtre imaginé");
    expect(text).toContain("reçois ceci comme une œuvre");
  });
});
