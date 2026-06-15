import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { z } from "zod";
import { textPayloadSchema } from "./totem.schemas";
import { GeneratedArtefact, QuestionnaireAnswer, TotemOffer, TotemTextPayload } from "./totem.types";

type TextRequest = {
  orderId: string;
  userId: string;
  customerName?: string | null;
  locale?: string | null;
  answers: QuestionnaireAnswer[];
};

type ImageRequest = {
  orderId: string;
  archetypeId: string;
  prompt: string;
};

type AudioRequest = {
  orderId: string;
  archetypeId: string;
  text: string;
};

type PdfRequest = {
  orderId: string;
  userId: string;
  customerName?: string | null;
  locale?: string | null;
  offer: TotemOffer;
  text: TotemTextPayload;
  answers: QuestionnaireAnswer[];
};

const anthropicResponseSchema = z.object({
  content: z
    .array(
      z
        .object({
          text: z.string().optional(),
        })
        .passthrough(),
    )
    .default([]),
});

const imageResponseSchema = z.object({
  data: z
    .array(
      z.object({
        b64_json: z.string().min(1).optional(),
        url: z.string().url().optional(),
      }),
    )
    .min(1),
});

@Injectable()
export class TotemAiService {
  private readonly anthropicApiKey: string;
  private readonly anthropicModel: string;
  private readonly openAiApiKey: string;
  private readonly openAiImageModel: string;
  private readonly openAiTtsModel: string;
  private readonly openAiTtsVoice: string;

  constructor(config: ConfigService) {
    this.anthropicApiKey = config.getOrThrow<string>("ANTHROPIC_API_KEY");
    this.anthropicModel = config.getOrThrow<string>("ANTHROPIC_MODEL");
    this.openAiApiKey = config.getOrThrow<string>("OPENAI_API_KEY");
    this.openAiImageModel = config.getOrThrow<string>("OPENAI_IMAGE_MODEL");
    this.openAiTtsModel = config.getOrThrow<string>("OPENAI_TTS_MODEL");
    this.openAiTtsVoice = config.getOrThrow<string>("OPENAI_TTS_VOICE");
  }

  async generateText(payload: TextRequest): Promise<TotemTextPayload> {
    const response = await fetchWithTimeout(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": this.anthropicApiKey,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.anthropicModel,
          max_tokens: 4500,
          temperature: 0.85,
          system: buildTextSystemPrompt(payload.locale),
          messages: [
            {
              role: "user",
              content: buildTextUserPrompt(payload),
            },
          ],
        }),
      },
      90_000,
    );

    await assertOk(response, "anthropic_text");
    const json = anthropicResponseSchema.parse(await response.json());
    const content = json.content
      .map((block) => block.text)
      .filter((text): text is string => typeof text === "string" && text.length > 0)
      .join("\n")
      .trim();

    return textPayloadSchema.parse(parseJsonObject(content));
  }

  async generateImage(payload: ImageRequest): Promise<GeneratedArtefact> {
    const response = await fetchWithTimeout(
      "https://api.openai.com/v1/images/generations",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.openAiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.openAiImageModel,
          prompt: payload.prompt,
          size: "1024x1024",
          quality: "low",
          n: 1,
        }),
      },
      240_000,
    );

    await assertOk(response, "openai_image");
    const json = imageResponseSchema.parse(await response.json());
    const image = json.data[0];

    if (!image) {
      throw new Error("openai_image_empty");
    }

    if (image.b64_json) {
      return {
        bytes: Buffer.from(image.b64_json, "base64"),
        contentType: "image/png",
        extension: "png",
      };
    }

    if (image.url) {
      return this.downloadArtefact(image.url, "image/png", "png");
    }

    throw new Error("openai_image_payload_missing");
  }

  async generateAudio(payload: AudioRequest): Promise<GeneratedArtefact> {
    const response = await fetchWithTimeout(
      "https://api.openai.com/v1/audio/speech",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.openAiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.openAiTtsModel,
          voice: this.openAiTtsVoice,
          input: payload.text.slice(0, 4000),
          response_format: "mp3",
        }),
      },
      240_000,
    );

    await assertOk(response, "openai_audio");

    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type")?.split(";")[0] ?? "audio/mpeg",
      extension: "mp3",
    };
  }

  async generatePdf(payload: PdfRequest): Promise<GeneratedArtefact> {
    return {
      bytes: await renderTotemPdf(payload),
      contentType: "application/pdf",
      extension: "pdf",
    };
  }

  private async downloadArtefact(
    url: string,
    fallbackContentType: string,
    fallbackExtension: string,
  ): Promise<GeneratedArtefact> {
    const response = await fetchWithTimeout(url, {}, 120_000);
    await assertOk(response, "artefact_download");
    const contentType = response.headers.get("content-type") ?? fallbackContentType;

    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType,
      extension: extensionFromContentType(contentType) ?? fallbackExtension,
    };
  }
}

function buildTextSystemPrompt(locale?: string | null): string {
  const language = locale?.startsWith("en") ? "anglais" : "francais";

  return `Tu es le moteur editorial de TOTEM ANCESTRAL. Tu crees un coffret digital spirituel et poetique a partir de dix reponses utilisateur.

Reponds uniquement avec un objet JSON valide, sans Markdown, sans commentaire, avec exactement ces cles :
{
  "archetypeId": "slug-court-en-minuscules",
  "ancestralName": "Nom public du totem",
  "parchmentText": "Texte long de parchemin",
  "audioMessage": "Texte plus court destine a la narration audio",
  "imagePrompt": "Prompt image detaille pour OpenAI, sans texte dans l'image"
}

Contraintes :
- Langue de sortie : ${language}.
- Ton : griot ancestral, mystique, intime, noble, jamais caricatural.
- parchmentText : 2500 a 4200 caracteres, paragraphes separes par des doubles sauts de ligne.
- audioMessage : 700 a 1200 caracteres, naturel a lire a voix haute.
- imagePrompt : decrire une oeuvre carree, symbolique, premium, sans typographie ni mot visible.
- archetypeId : ASCII, kebab-case, stable.
- ancestralName : court, memorisable, sans emoji.`;
}

function buildTextUserPrompt(payload: TextRequest): string {
  const name = payload.customerName?.trim() || "cette personne";
  const answers = payload.answers
    .map((answer, index) => `${index + 1}. ${answer.questionId}: ${answer.answer}`)
    .join("\n");

  return `Commande: ${payload.orderId}
Utilisateur: ${payload.userId}
Prenom ou nom: ${name}

Reponses du parcours initiatique :
${answers}

Compose maintenant le JSON final du coffret TOTEM ANCESTRAL.`;
}

async function renderTotemPdf(payload: PdfRequest): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const width = 595;
  const height = 842;
  const titleFont = await doc.embedFont(StandardFonts.TimesRomanBold);
  const bodyFont = await doc.embedFont(StandardFonts.TimesRoman);
  const italicFont = await doc.embedFont(StandardFonts.TimesRomanItalic);

  const firstPage = doc.addPage([width, height]);
  drawBackground(firstPage, width, height);
  drawCentered(firstPage, titleFont, "TOTEM ANCESTRAL", 24, height - 92, width, pdfColor("ink"));
  drawCentered(firstPage, italicFont, "Certificat de revelation symbolique", 13, height - 122, width, pdfColor("soft"));
  drawCentered(firstPage, titleFont, normalizePdfText(payload.text.ancestralName).toUpperCase(), 28, height - 205, width, pdfColor("ink"));

  const holder = payload.customerName
    ? `Prepare pour ${payload.customerName}`
    : "Oeuvre personnelle et unique";
  drawCentered(firstPage, bodyFont, holder, 12, height - 238, width, pdfColor("soft"));
  drawCentered(firstPage, bodyFont, `Offre: ${payload.offer.toUpperCase()}`, 10, 120, width, pdfColor("goldDark"));
  firstPage.drawText(`Commande: ${payload.orderId}`, {
    x: 56,
    y: 58,
    size: 8,
    font: bodyFont,
    color: pdfColor("soft"),
  });

  const paragraphs = payload.text.parchmentText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  let page = doc.addPage([width, height]);
  drawBackground(page, width, height);
  drawCentered(page, titleFont, "LE RECIT", 16, height - 78, width, pdfColor("goldDark"));

  const marginX = 68;
  const topY = height - 120;
  const bottomY = 78;
  const maxWidth = width - marginX * 2;
  const fontSize = 11;
  const lineHeight = 16;
  let y = topY;

  for (const paragraph of paragraphs) {
    const lines = wrapPdfText(paragraph, bodyFont, fontSize, maxWidth);
    for (const line of lines) {
      if (y < bottomY) {
        page = doc.addPage([width, height]);
        drawBackground(page, width, height);
        y = topY;
      }

      page.drawText(line, {
        x: marginX,
        y,
        size: fontSize,
        font: bodyFont,
        color: pdfColor("ink"),
      });
      y -= lineHeight;
    }
    y -= lineHeight * 0.7;
  }

  if (y < bottomY + 50) {
    page = doc.addPage([width, height]);
    drawBackground(page, width, height);
    y = topY;
  }

  y -= 18;
  drawCentered(page, italicFont, `Totem: ${payload.text.ancestralName}`, 12, y, width, pdfColor("goldDark"));

  return doc.save();
}

function drawBackground(page: PDFPage, width: number, height: number): void {
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.95, 0.9, 0.74) });
  page.drawRectangle({
    x: 32,
    y: 32,
    width: width - 64,
    height: height - 64,
    borderColor: pdfColor("gold"),
    borderWidth: 1.4,
  });
  page.drawRectangle({
    x: 43,
    y: 43,
    width: width - 86,
    height: height - 86,
    borderColor: pdfColor("goldDark"),
    borderWidth: 0.5,
    opacity: 0.55,
  });
}

function drawCentered(
  page: PDFPage,
  font: PDFFont,
  text: string,
  size: number,
  y: number,
  pageWidth: number,
  color: ReturnType<typeof rgb>,
): void {
  const safe = normalizePdfText(text);
  page.drawText(safe, {
    x: pageWidth / 2 - font.widthOfTextAtSize(safe, size) / 2,
    y,
    size,
    font,
    color,
  });
}

function wrapPdfText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = normalizePdfText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }

  if (current) lines.push(current);
  return lines;
}

function normalizePdfText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/œ/g, "oe")
    .replace(/Œ/g, "OE")
    .replace(/[^\x20-\x7E]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pdfColor(name: "ink" | "soft" | "gold" | "goldDark"): ReturnType<typeof rgb> {
  if (name === "ink") return rgb(0.12, 0.04, 0.01);
  if (name === "soft") return rgb(0.35, 0.16, 0.02);
  if (name === "gold") return rgb(0.85, 0.66, 0.25);
  return rgb(0.54, 0.31, 0.06);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`request_timeout:${url}`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function assertOk(response: Response, label: string): Promise<void> {
  if (response.ok) return;

  const detail = await response.text().catch(() => "");
  throw new Error(`${label}_failed:${response.status}:${detail.slice(0, 500)}`);
}

function parseJsonObject(value: string): unknown {
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? value;

  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");

    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1));
    }

    throw new Error("anthropic_text_json_missing");
  }
}

function extensionFromContentType(contentType: string): string | undefined {
  const clean = contentType.split(";")[0]?.trim();

  if (clean === "image/png") return "png";
  if (clean === "image/jpeg") return "jpg";
  if (clean === "audio/mpeg") return "mp3";
  if (clean === "audio/wav") return "wav";
  if (clean === "application/pdf") return "pdf";

  return undefined;
}
