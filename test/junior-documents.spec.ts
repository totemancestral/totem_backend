import { describe, expect, it, vi, afterEach } from "vitest";
import { PDFDocument, PDFPage, PDFName, PDFString } from "pdf-lib";
import { generateJuniorDocuments } from "../src/totem/junior-documents";
import { juniorDetails, juniorSerialNumber } from "../src/totem/junior-content";
import { computeReveal, JUNIOR_TOTEM_ANIMALS } from "../src/totem/junior.service";
import type { JuniorTotemId } from "../src/totem/feta-scoring";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

afterEach(() => vi.restoreAllMocks());
describe("Junior documents", () => {
  it("fits every animal profile and an 80-character nickname without clipping", async () => {
    const draw = PDFPage.prototype.drawText;
    vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, text, options) {
      expect(options?.y).toBeGreaterThanOrEqual(45);
      expect(options?.x).toBeGreaterThanOrEqual(40);
      return draw.call(this, text, options);
    });
    const image = { bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ZkAAAAASUVORK5CYII=", "base64"), contentType: "image/png", extension: "png" };
    for (const id of Object.keys(JUNIOR_TOTEM_ANIMALS) as JuniorTotemId[]) {
      for (const locale of ["fr", "en"]) {
        const details = juniorDetails(id, locale);
        await generateJuniorDocuments({ orderId: "test", firstName: "W".repeat(80), locale, createdAt: new Date("2026-11-17"), image,
          reveal: { ...details, name: "SEUN L’ÉLÉPHANT GARDIEN", quality: details.secondaryAttributes[0]!, phrase: "Avant toi, un ancêtre portait la protection dans son geste, et ce signe avance maintenant avec ton nom." } });
      }
    }
  });
  it("preserves extended Latin characters in the child's name", async () => {
    const texts: string[] = [];
    vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, text) { texts.push(text); return this; });
    const image = { bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ZkAAAAASUVORK5CYII=", "base64"), contentType: "image/png", extension: "png" };
    await generateJuniorDocuments({ orderId: "test", firstName: "Ọlá Łukasz", locale: "fr", createdAt: new Date("2026-11-17"), image,
      reveal: { ...juniorDetails("zara_leopard", "fr"), name: "ZARA", quality: "Précision", phrase: "Une phrase." } });
    expect(texts.filter(text => text === "Ọlá Łukasz")).toHaveLength(2);
  });
  it.each(["fr", "en"])("embeds the totem and all six identity fields in %s with a matching numbered certificate", async locale => {
    const texts: string[] = [];
    const draw = PDFPage.prototype.drawText;
    vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, text, options) { texts.push(text); return draw.call(this, text, options); });
    const answers = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [String(i + 1), { choice: "A" }]));
    const reveal = computeReveal(answers, undefined, locale);
    const image = { bytes: process.env.JUNIOR_PDF_PREVIEW_DIR
      ? await readFile(join(process.cwd(), "../projet-totem-ancestral/public/images/totem-mask-or-1024.png"))
      : Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9ZkAAAAASUVORK5CYII=", "base64"), contentType: "image/png", extension: "png" };
    const output = await generateJuniorDocuments({ orderId: "00000000-0000-4000-8000-000000000001", firstName: "Élodie", locale, createdAt: new Date("2026-11-17"), reveal, image });
    for (const document of Object.values(output)) {
      const pdf = await PDFDocument.load(document.bytes);
      expect(pdf.getPageCount()).toBe(1); expect(pdf.catalog.lookup(PDFName.of("Lang"), PDFString).decodeText()).toBe(locale);
      expect(document.contentType).toBe("application/pdf");
    }
    const printed = texts.join(" ");
    for (const value of [reveal.name, reveal.animal, reveal.quality, reveal.phrase, reveal.clanWelcome, ...reveal.secondaryAttributes]) {
      expect(printed).toContain(value.replace(/[\u2010-\u2015]/g, "-"));
    }
    expect(printed).toContain("Élodie");
    expect(texts.filter(text => text === juniorSerialNumber("00000000-0000-4000-8000-000000000001"))).toHaveLength(2);
    if (process.env.JUNIOR_PDF_PREVIEW_DIR) {
      await mkdir(process.env.JUNIOR_PDF_PREVIEW_DIR, { recursive: true });
      for (const [kind, file] of Object.entries(output)) await writeFile(join(process.env.JUNIOR_PDF_PREVIEW_DIR, `junior-${locale}-${kind}.pdf`), file.bytes);
    }
  });
  it("uses the supplied Leopard example and different animal-specific attributes", () => {
    expect(juniorDetails("zara_leopard", "fr")).toEqual({ animal: "Léopard", clanWelcome: "Bienvenue dans le Clan du Léopard - tu frappes juste, au bon moment.", secondaryAttributes: ["Précision", "Mystère", "Tranchant", "Silence"] });
    expect(juniorDetails("imani_tortue", "fr").secondaryAttributes).not.toContain("Tranchant");
    expect(juniorSerialNumber("one")).not.toBe(juniorSerialNumber("two"));
  });
});
