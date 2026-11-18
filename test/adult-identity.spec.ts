import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFPage } from "pdf-lib";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { adultIdentityFor } from "../src/totem/adult-identity";
import { TOTEM_ANIMALS } from "../src/totem/totem-animals";
import { TotemAiService } from "../src/totem/totem-ai.service";
import { buildAdultV3Context, buildAdultV3FallbackPayload } from "../src/totem/totem-v3-pipeline";

afterEach(() => vi.restoreAllMocks());
describe("adult ancestral identity", () => {
  it("matches the Eagle wording supplied in the corrections", () => {
    expect(adultIdentityFor("aigle", "fr")).toEqual({ animal: "Aigle", quality: "Vision",
      identityPhrase: "Avant toi, un ancêtre grimpait les falaises pour lire les étoiles avant tout le monde.",
      secondaryAttributes: ["Vision", "Élévation", "Messager", "Liberté"] });
    expect(adultIdentityFor("unknown", "fr")).toBeNull();
    expect(adultIdentityFor("toString", "fr")).toBeNull();
  });
  it("provides all four fields for every supported animal in both languages", () => {
    for (const animal of TOTEM_ANIMALS) for (const lang of ["fr", "en"]) {
      const identity = adultIdentityFor(animal.slug, lang)!;
      expect(identity.animal).toBeTruthy(); expect(identity.quality).toBeTruthy();
      expect(identity.identityPhrase.length).toBeGreaterThan(30);
      expect(identity.secondaryAttributes).toHaveLength(4);
      expect(identity.secondaryAttributes[0]).toBe(identity.quality);
    }
  });
  it("persists identity with the generated payload for the actual revealed animal", () => {
    const context = buildAdultV3Context({ orderId: "identity-test", locale: "en",
      answers: Array.from({ length: 10 }, (_, i) => ({ questionId: `q${i + 1}`, answer: "A" })) });
    const payload = buildAdultV3FallbackPayload(context);
    expect(payload.adultIdentity).toEqual(adultIdentityFor(payload.archetypeId, "en"));
    expect(payload.parchmentText).toBeTruthy(); expect(payload.audioMessage).toBeTruthy();
  });
  it.each(["fr", "en"])("renders the %s identity between the existing cover and complete story", async locale => {
    const texts: string[] = [];
    const draw = PDFPage.prototype.drawText;
    vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, text, options) {
      texts.push(text); return draw.call(this, text, options);
    });
    const story = locale === "en" ? "The ancestor walked towards the river. The whole story remains here."
      : "L’ancêtre marchait vers le fleuve. Son histoire reste entière ici.";
    const input = { orderId: "EXEMPLE-ADULTE", userId: "preview", customerName: "Ayo", locale, offer: "ancestral" as const, answers: [],
      text: { archetypeId: "aigle", ancestralName: "Ayo-Kemi, Porteur de lumière", parchmentText: story,
        audioMessage: "Narration", imagePrompt: "A mask", storyPages: [] },
      image: { bytes: process.env.ADULT_PDF_PREVIEW_DIR
        ? await readFile(join(process.cwd(), "../projet-totem-ancestral/public/images/totem-mask-or-1024.png"))
        : Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ZkAAAAASUVORK5CYII=", "base64"), contentType: "image/png", extension: "png" },
    };
    const ai = new TotemAiService({ getOrThrow: () => "test-only", get: () => undefined } as never);
    const artefact = await ai.generatePdf(input);
    const pdf = await PDFDocument.load(artefact.bytes);
    expect(pdf.getPageCount()).toBe(3);
    const identity = adultIdentityFor("aigle", locale)!;
    const printed = texts.join(" ").replace(/\s+/g, " ");
    for (const value of [identity.animal, identity.quality, identity.identityPhrase, ...identity.secondaryAttributes, story]) expect(printed.replace(/’/g, "'")).toContain(value.replace(/’/g, "'"));
    expect(texts.findIndex(s => s.includes(locale === "en" ? "YOUR ANCESTRAL IDENTITY" : "VOTRE IDENTITÉ ANCESTRALE"))).toBeLessThan(texts.findIndex(s => s.includes(locale === "en" ? "ANCESTRAL STORY" : "HISTOIRE ANCESTRALE")));
    expect((await PDFDocument.load((await ai.generateCertificate(input)).bytes)).getPageCount()).toBe(1);
    if (process.env.ADULT_PDF_PREVIEW_DIR) {
      await mkdir(process.env.ADULT_PDF_PREVIEW_DIR, { recursive: true });
      await writeFile(join(process.env.ADULT_PDF_PREVIEW_DIR, `exemple-carte-adulte-${locale}.pdf`), artefact.bytes);
    }
  }, 20_000);
});
