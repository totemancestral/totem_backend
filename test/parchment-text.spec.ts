import { describe, expect, it } from "vitest";
import { deliveredParchmentText, parchmentParagraphs } from "../src/totem/parchment-text";

describe("one ancestral parchment", () => {
  it("uses the complete story once instead of appending its titled pages", () => {
    const payload = { parchmentText: "First passage.\n\nSecond passage.", storyPages: [
      { title: "Opening", text: "First passage." }, { title: "Portrait", text: "Second passage." },
    ] };
    expect(deliveredParchmentText(payload)).toBe("First passage.\n\nSecond passage.");
  });
  it("uses page bodies when the complete story is missing", () => {
    expect(deliveredParchmentText({ parchmentText: " ", storyPages: [{ text: "First passage." }, { text: "Second passage." }] }))
      .toBe("First passage.\n\nSecond passage.");
  });
  it("repairs an exact historical repeated story with headings", () => {
    expect(parchmentParagraphs("First passage.\n\nSecond passage.\n\nLe Portrait\nFirst passage.\n\nLe Passage\nSecond passage."))
      .toEqual(["First passage.", "Second passage."]);
  });
  it("preserves distinct passages, including a short opening line", () => {
    expect(parchmentParagraphs("Welcome\nYour journey begins.\n\nAnother story entirely."))
      .toEqual(["Welcome\nYour journey begins.", "Another story entirely."]);
  });
  it("removes recognized French and English movement headings", () => {
    expect(parchmentParagraphs("L’Épreuve\nA challenge.\n\nThe Passage\nAn ending."))
      .toEqual(["A challenge.", "An ending."]);
  });
});
