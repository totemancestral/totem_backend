import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { GeneratedArtefact } from "./totem.types";
import { juniorSerialNumber } from "./junior-content";
import fontkit from "@pdf-lib/fontkit";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export type JuniorDocumentInput = {
  orderId: string; firstName: string; locale?: string | null; createdAt: Date;
  reveal: { name: string; animal: string; quality: string; phrase: string; clanWelcome: string; secondaryAttributes: string[] };
  image: GeneratedArtefact;
};
const ink = rgb(.15, .12, .10), gold = rgb(.57, .40, .15), paper = rgb(.98, .96, .90);
const clean = (value: string, font: PDFFont) => Array.from(value.replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ").trim()).map(c => {
  try { font.encodeText(c); return c; } catch { return "?"; }
}).join("");

function lines(value: string, font: PDFFont, size: number, width: number) {
  const result: string[] = []; let line = "";
  for (const word of clean(value, font).split(" ")) {
    if (line && font.widthOfTextAtSize(`${line} ${word}`, size) > width) { result.push(line); line = ""; }
    if (font.widthOfTextAtSize(word, size) <= width) { line += (line ? " " : "") + word; continue; }
    for (const char of word) {
      if (font.widthOfTextAtSize(line + char, size) > width && line) { result.push(line); line = ""; }
      line += char;
    }
  }
  if (line.trim()) result.push(line.trim());
  return result;
}
function paragraph(page: PDFPage, value: string, font: PDFFont, size: number, x: number, y: number, width: number, centered = false) {
  for (const line of lines(value, font, size, width)) {
    page.drawText(line, { x: centered ? x + (width - font.widthOfTextAtSize(line, size)) / 2 : x, y, font, size, color: ink });
    y -= size * 1.4;
  }
  return y;
}
async function base(title: string, input: JuniorDocumentInput) {
  const doc = await PDFDocument.create(); doc.setTitle(title); doc.setAuthor("Totem Ancestral"); doc.setLanguage(input.locale === "en" ? "en" : "fr");
  doc.setCreationDate(input.createdAt);
  const page = doc.addPage([595, 842]);
  const body = await doc.embedFont(StandardFonts.TimesRoman), bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  let nameFont = bold;
  if (Array.from(input.firstName).some(char => !bold.getCharacterSet().includes(char.codePointAt(0)!))) {
    doc.registerFontkit(fontkit);
    nameFont = await doc.embedFont(await readFile(join(process.cwd(), "assets/fonts/DancingScript-Regular.ttf")), { subset: true });
  }
  page.drawRectangle({ x: 0, y: 0, width: 595, height: 842, color: paper });
  page.drawRectangle({ x: 25, y: 25, width: 545, height: 792, borderColor: gold, borderWidth: 1.3 });
  page.drawRectangle({ x: 31, y: 31, width: 533, height: 780, borderColor: gold, borderWidth: .4 });
  paragraph(page, "TOTEM ANCESTRAL", bold, 25, 45, 775, 505, true);
  paragraph(page, title, body, 15, 45, 744, 505, true);
  paragraph(page, juniorSerialNumber(input.orderId), body, 9, 45, 48, 505, true);
  return { doc, page, body, bold, nameFont };
}
const artefact = (bytes: Uint8Array): GeneratedArtefact => ({ bytes, contentType: "application/pdf", extension: "pdf" });

export async function generateJuniorDocuments(input: JuniorDocumentInput) {
  const en = input.locale === "en";
  const card = await base(en ? "ANCESTRAL CARD - JUNIOR" : "CARTE ANCESTRALE - JUNIOR", input);
  const image = input.image.contentType.includes("png") ? await card.doc.embedPng(input.image.bytes) : await card.doc.embedJpg(input.image.bytes);
  const fit = image.scaleToFit(220, 220);
  card.page.drawImage(image, { x: (595 - fit.width) / 2, y: 494 + (220 - fit.height) / 2, width: fit.width, height: fit.height });
  let y = paragraph(card.page, input.firstName, card.nameFont, input.firstName.length > 40 ? 11 : 16, 50, 475, 495, true) - 10;
  const r = input.reveal;
  const labels = en ? ["Your sacred ancestral name", "Your totem animal", "Your main quality", "Your identity phrase", "Your clan's welcome message", "Your secondary attributes"]
    : ["Ton nom ancestral sacré", "Ton animal totem", "Ta qualité principale", "Ta phrase d’identité", "Le message d’accueil de ton clan", "Tes attributs secondaires"];
  for (const [index, value] of [r.name, r.animal, r.quality, r.phrase, r.clanWelcome, r.secondaryAttributes.join(" / ")].entries()) {
    const needed = 14 + lines(value, card.body, 12, 475).length * 16.8 + 12;
    if (y - needed < 78) throw new Error("junior_card_content_overflow");
    y = paragraph(card.page, labels[index]!, card.bold, 10, 60, y, 475) - 2;
    y = paragraph(card.page, value, card.body, 12, 60, y, 475) - 12;
  }
  const cert = await base(en ? "CERTIFICATE OF AUTHENTICITY" : "CERTIFICAT D’AUTHENTICITÉ", input);
  paragraph(cert.page, "JUNIOR", cert.body, 12, 60, 675, 475, true);
  let cy = paragraph(cert.page, en ? "This certificate authenticates the ancestral creation prepared for" : "Ce certificat atteste l’authenticité de la création ancestrale préparée pour", cert.body, 16, 75, 610, 445, true) - 30;
  cy = paragraph(cert.page, input.firstName, cert.nameFont, input.firstName.length > 40 ? 16 : 24, 65, cy, 465, true) - 35;
  cy = paragraph(cert.page, r.name, cert.bold, 21, 65, cy, 465, true) - 25;
  paragraph(cert.page, `${r.animal} / ${r.quality}`, cert.body, 16, 65, cy, 465, true);
  paragraph(cert.page, en ? "A personal symbolic creation, revealed from the Junior journey." : "Une création symbolique personnelle, révélée à partir du parcours Junior.", cert.body, 14, 75, 290, 445, true);
  cert.page.drawCircle({ x: 297.5, y: 175, size: 33, color: rgb(.46, .10, .08), borderColor: gold, borderWidth: 2 });
  cert.page.drawText("TA", { x: 280, y: 168, font: cert.bold, size: 24, color: paper });
  paragraph(cert.page, `${en ? "Issued on" : "Émis le"} ${input.createdAt.toISOString().slice(0, 10)}`, cert.body, 11, 65, 102, 465, true);
  return { pdf: artefact(await card.doc.save()), certificate: artefact(await cert.doc.save()) };
}
