import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { z } from "zod";
import { textPayloadSchema } from "./totem.schemas";
import {
  GeneratedArtefact,
  QuestionnaireAnswer,
  TotemOffer,
  TotemStoryPage,
  TotemTextPayload,
} from "./totem.types";

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
  image?: GeneratedArtefact;
  storyImages?: GeneratedArtefact[];
};

type StoryImagesRequest = {
  orderId: string;
  archetypeId: string;
  text: TotemTextPayload;
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
  private readonly storyPageCount: number;
  private readonly imageGenerationConcurrency: number;

  constructor(config: ConfigService) {
    this.anthropicApiKey = config.getOrThrow<string>("ANTHROPIC_API_KEY");
    this.anthropicModel = config.getOrThrow<string>("ANTHROPIC_MODEL");
    this.openAiApiKey = config.getOrThrow<string>("OPENAI_API_KEY");
    this.openAiImageModel = config.getOrThrow<string>("OPENAI_IMAGE_MODEL");
    this.openAiTtsModel = config.getOrThrow<string>("OPENAI_TTS_MODEL");
    this.openAiTtsVoice = config.getOrThrow<string>("OPENAI_TTS_VOICE");
    this.storyPageCount = config.get<number>("TOTEM_STORY_PAGE_COUNT") ?? 20;
    this.imageGenerationConcurrency = config.get<number>("TOTEM_IMAGE_GENERATION_CONCURRENCY") ?? 2;
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
          max_tokens: 16000,
          temperature: 0.85,
          system: buildTextSystemPrompt(payload.locale, this.storyPageCount),
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

  buildStoryPages(text: TotemTextPayload): TotemStoryPage[] {
    return ensureStoryPages(text, this.storyPageCount);
  }

  buildAudioNarration(text: TotemTextPayload): string {
    return buildAudioNarration(text, this.storyPageCount);
  }

  async generateStoryImages(payload: StoryImagesRequest): Promise<GeneratedArtefact[]> {
    const storyPages = this.buildStoryPages(payload.text);

    return mapWithConcurrency(storyPages, this.imageGenerationConcurrency, (page) =>
      this.generateImage({
        orderId: payload.orderId,
        archetypeId: payload.archetypeId,
        prompt: buildSceneImagePrompt(payload.text, page),
      }),
    );
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
          prompt: buildTotemSculpturePrompt(payload.prompt),
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
    const chunks = chunkTtsText(payload.text, 3600);
    const buffers: Buffer[] = [];

    for (let index = 0; index < chunks.length; index += 1) {
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
            input: chunks[index],
            instructions:
              "Voix grave, lente et voilee, comme un ancetre revenu des profondeurs. Diction rituelle, souffle ancien, emotion contenue, pauses marquees entre les images fortes.",
            response_format: "mp3",
          }),
        },
        240_000,
      );

      await assertOk(response, `openai_audio_${index + 1}`);
      buffers.push(Buffer.from(await response.arrayBuffer()));
    }

    return {
      bytes: Buffer.concat(buffers),
      contentType: "audio/mpeg",
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

function buildTextSystemPrompt(locale?: string | null, storyPageCount = 20): string {
  const language = locale?.startsWith("en") ? "anglais" : "francais";

  return `Tu es le moteur editorial de TOTEM ANCESTRAL. Tu crees un coffret digital spirituel et poetique a partir de dix reponses utilisateur.

Reponds uniquement avec un objet JSON valide, sans Markdown, sans commentaire, avec exactement ces cles :
{
  "archetypeId": "slug-court-en-minuscules",
  "ancestralName": "Nom public du totem",
  "parchmentText": "Texte long de parchemin",
  "audioMessage": "Introduction courte destinee a la narration audio",
  "imagePrompt": "Prompt image detaille pour OpenAI, sans texte dans l'image",
  "storyPages": [
    { "page": 1, "title": "Titre de scene", "text": "Texte narratif de cette page", "imagePrompt": "Prompt image de cette page, sans texte dans l'image" }
  ]
}

Contraintes :
- Langue de sortie : ${language}.
- Ton : griot ancestral, mystique, intime, noble, jamais caricatural.
- Le totem doit etre un animal/archetype central identifiable et stable dans tout le coffret.
- parchmentText : prologue rituel de 1200 a 1800 caracteres, paragraphes separes par des doubles sauts de ligne.
- storyPages : exactement ${storyPageCount} objets, numerotes de 1 a ${storyPageCount}.
- Chaque storyPages[i].text : 650 a 950 caracteres, autonome, narratif, concordant avec son imagePrompt, et toujours relie au meme totem.
- Chaque storyPages[i].imagePrompt : decrire une scene premium carree ou verticale dans l'univers de cette page, avec le meme animal totem reconnaissable sous forme de sculpture/artefact rituel noir, bronze et or, gravures ancestrales, dans des lieux/epoques/ambiances varies, sans typographie ni mot visible.
- Aucune page ne doit etre seulement decorative : chaque imagePrompt doit correspondre directement au texte de la meme page.
- audioMessage : 500 a 900 caracteres, naturel a lire a voix haute, comme ouverture avant la grande histoire.
- imagePrompt : decrire la couverture carree, symbolique, premium, avec le meme totem en sculpture rituelle noire/bronze/or, sans typographie ni mot visible.
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

function ensureStoryPages(text: TotemTextPayload, minimumCount: number): TotemStoryPage[] {
  const pages = text.storyPages
    .filter((page) => page.text.trim().length > 0)
    .map((page, index) => ({
      page: index + 1,
      title: page.title.trim() || `Page ${index + 1}`,
      text: page.text.trim(),
      imagePrompt: page.imagePrompt.trim() || fallbackScenePrompt(text, index + 1),
    }));

  if (pages.length >= minimumCount) {
    return pages.slice(0, minimumCount).map((page, index) => ({ ...page, page: index + 1 }));
  }

  const fallbackChunks = splitTextIntoChunks(text.parchmentText, minimumCount);
  for (let index = pages.length; index < minimumCount; index += 1) {
    pages.push({
      page: index + 1,
      title: `Memoire ${index + 1}`,
      text:
        fallbackChunks[index] ??
        `Le totem ${text.ancestralName} poursuit sa marche dans une vision ancienne. Son souffle traverse les signes, rassemble les fragments de memoire et ouvre un passage pour la personne qui recoit cette oeuvre.`,
      imagePrompt: fallbackScenePrompt(text, index + 1),
    });
  }

  return pages;
}

function buildAudioNarration(text: TotemTextPayload, minimumCount: number): string {
  const pages = ensureStoryPages(text, minimumCount);
  const sections = [
    text.audioMessage,
    text.parchmentText,
    ...pages.map((page) => `${page.title}. ${page.text}`),
  ];

  return sections
    .map((section) => section.trim())
    .filter(Boolean)
    .join("\n\n")
    .slice(0, 28_000);
}

function buildSceneImagePrompt(text: TotemTextPayload, page: TotemStoryPage): string {
  return [
    page.imagePrompt,
    `Central totem: ${text.ancestralName} (${text.archetypeId}).`,
    "The same animal/archetype must be recognizable across every page as a carved ritual sculpture, but the scene, environment, lighting and symbolic universe must match this page text.",
    `Page text to illustrate: ${page.text.slice(0, 900)}`,
    "Premium ancestral sculpture artwork, cinematic composition, sacred atmosphere, no letters, no typography, no visible words, no watermark.",
  ].join("\n");
}

function buildTotemSculpturePrompt(prompt: string): string {
  return [
    prompt,
    "Mandatory visual style: the animal totem must be a premium sculptural artefact, not a flat illustration. Materials: carved black ebony or obsidian, aged bronze, dark metal and fine gold inlays. Surface: engraved geometric ancestral patterns, ritual symbols, hand-carved relief, polished edges, visible depth and craft.",
    "Composition: centered full-body statue or ceremonial object, dramatic product-photography lighting, deep blue-black background, subtle floating golden dust, high contrast, crisp details, museum-grade sacred artefact, cinematic realism.",
    "Do not generate text, letters, logos, watermark, labels, UI, human faces, modern objects or cartoon style.",
  ].join("\n");
}

function fallbackScenePrompt(text: TotemTextPayload, page: number): string {
  const realms = [
    "a moonlit ancestral forest",
    "a river of bronze under a dawn sky",
    "a mountain sanctuary carved in dark stone",
    "a desert of red dust and ritual smoke",
    "a starry village threshold with sacred fire",
    "a cavern of ochre paintings and golden embers",
    "a storm coast where waves carry old names",
    "a field of tall grass crossed by spirit wind",
    "a royal courtyard of carved wood and shadow",
    "a cosmic night path under ancestral constellations",
  ];
  const realm = realms[(page - 1) % realms.length];

  return `Illustrate page ${page} of a long ancestral story: the same totem animal ${text.ancestralName} appears as a carved black, bronze and gold ritual sculpture in ${realm}, carrying memory, protection and revelation. Premium symbolic artefact artwork, no text, no typography.`;
}

function splitTextIntoChunks(text: string, count: number): string[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const chunks = Array.from({ length: count }, () => "");

  sentences.forEach((sentence, index) => {
    chunks[index % count] = `${chunks[index % count]} ${sentence}`.trim();
  });

  return chunks.map((chunk) => chunk.trim()).filter(Boolean);
}

function chunkTtsText(text: string, maxLength: number): string[] {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }

    if (current) chunks.push(current);
    if (paragraph.length <= maxLength) {
      current = paragraph;
      continue;
    }

    for (let index = 0; index < paragraph.length; index += maxLength) {
      chunks.push(paragraph.slice(index, index + maxLength));
    }
    current = "";
  }

  if (current) chunks.push(current);
  return chunks.length > 0 ? chunks : [text.slice(0, maxLength)];
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function run(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      const item = items[index];
      if (item === undefined) continue;
      results[index] = await worker(item, index);
    }
  }

  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, run);
  await Promise.all(workers);
  return results;
}

async function renderTotemPdf(payload: PdfRequest): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const width = 595;
  const height = 842;
  const titleFont = await doc.embedFont(StandardFonts.TimesRomanBold);
  const bodyFont = await doc.embedFont(StandardFonts.TimesRoman);
  const italicFont = await doc.embedFont(StandardFonts.TimesRomanItalic);

  const firstPage = doc.addPage([width, height]);
  const firstBox = drawRoyalParchment(firstPage, width, height);
  drawCentered(firstPage, titleFont, "TOTEM ANCESTRAL", 24, height - 102, width, pdfColor("ink"));
  drawCentered(
    firstPage,
    italicFont,
    "Decret royal de revelation symbolique",
    13,
    height - 130,
    width,
    pdfColor("soft"),
  );
  drawCentered(firstPage, bodyFont, "--- * ---", 10, height - 152, width, pdfColor("goldDark"));

  let titleY = height - 230;
  const coverImage = await embedPdfImage(doc, payload.image);
  if (coverImage) {
    const imageSize = 250;
    const imageX = width / 2 - imageSize / 2;
    const imageY = height - 440;
    firstPage.drawRectangle({
      x: imageX - 7,
      y: imageY - 7,
      width: imageSize + 14,
      height: imageSize + 14,
      color: pdfColor("goldDark"),
      opacity: 0.45,
    });
    firstPage.drawRectangle({
      x: imageX - 3,
      y: imageY - 3,
      width: imageSize + 6,
      height: imageSize + 6,
      color: pdfColor("gold"),
      opacity: 0.9,
    });
    firstPage.drawImage(coverImage, { x: imageX, y: imageY, width: imageSize, height: imageSize });
    titleY = imageY - 52;
  }

  drawCenteredFit(
    firstPage,
    titleFont,
    normalizePdfText(payload.text.ancestralName).toUpperCase(),
    28,
    titleY,
    width,
    width - 112,
    pdfColor("ink"),
  );

  const holder = payload.customerName
    ? `Prepare pour ${payload.customerName}`
    : "Oeuvre personnelle et unique";
  drawCentered(firstPage, bodyFont, holder, 12, titleY - 33, width, pdfColor("soft"));
  drawWaxSeal(firstPage, width / 2, firstBox.y + 74, 26, titleFont);
  drawCentered(
    firstPage,
    bodyFont,
    `Offre: ${payload.offer.toUpperCase()}`,
    10,
    firstBox.y + 118,
    width,
    pdfColor("goldDark"),
  );
  firstPage.drawText(`Commande: ${payload.orderId}`, {
    x: firstBox.x + 18,
    y: firstBox.y + 24,
    size: 8,
    font: bodyFont,
    color: pdfColor("soft"),
  });

  const storyPageCount = Math.max(
    20,
    payload.text.storyPages.length,
    payload.storyImages?.length ?? 0,
  );
  const storyPages = ensureStoryPages(payload.text, storyPageCount);
  const storyImages: Array<PDFImage | null> = [];
  for (let index = 0; index < storyPages.length; index += 1) {
    storyImages.push(await embedPdfImage(doc, payload.storyImages?.[index] ?? payload.image));
  }

  storyPages.forEach((storyPage, index) => {
    const page = doc.addPage([width, height]);
    const box = drawRoyalParchment(page, width, height);
    drawStoryPage(
      page,
      { titleFont, bodyFont, italicFont },
      storyPage,
      storyImages[index] ?? coverImage,
      index + 1,
      storyPages.length,
      width,
      height,
      box,
    );
  });

  return doc.save();
}

function drawRoyalParchment(
  page: PDFPage,
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  drawScene(page, width, height);

  const scrollWidth = Math.min(470, width - 82);
  const x = width / 2 - scrollWidth / 2;
  const topRodY = height - 82;
  const bottomRodY = 46;
  const rodHeight = 26;
  const curlHeight = 22;
  const bodyY = bottomRodY + rodHeight + curlHeight;
  const bodyH = topRodY - bodyY - curlHeight;

  drawRod(page, x, topRodY, scrollWidth, rodHeight);
  drawRod(page, x, bottomRodY, scrollWidth, rodHeight);
  drawCurl(page, x, topRodY - curlHeight, scrollWidth, curlHeight, "top");
  drawCurl(page, x, bodyY - curlHeight, scrollWidth, curlHeight, "bottom");
  drawParchmentBody(page, x, bodyY, scrollWidth, bodyH);

  return { x, y: bodyY, width: scrollWidth, height: bodyH };
}

function drawStoryPage(
  page: PDFPage,
  fonts: { titleFont: PDFFont; bodyFont: PDFFont; italicFont: PDFFont },
  storyPage: TotemStoryPage,
  image: PDFImage | null,
  pageNumber: number,
  totalPages: number,
  pageWidth: number,
  pageHeight: number,
  box: { x: number; y: number; width: number; height: number },
): void {
  drawCenteredFit(
    page,
    fonts.titleFont,
    storyPage.title.toUpperCase(),
    15,
    pageHeight - 104,
    pageWidth,
    box.width - 110,
    pdfColor("goldDark"),
  );
  drawCentered(
    page,
    fonts.bodyFont,
    "--- * ---",
    10,
    pageHeight - 126,
    pageWidth,
    pdfColor("goldDark"),
  );

  const frameWidth = Math.min(286, box.width - 108);
  const frameHeight = 188;
  const frameX = pageWidth / 2 - frameWidth / 2;
  const frameY = pageHeight - 344;

  page.drawRectangle({
    x: frameX - 6,
    y: frameY - 6,
    width: frameWidth + 12,
    height: frameHeight + 12,
    color: pdfColor("goldDark"),
    opacity: 0.38,
  });
  page.drawRectangle({
    x: frameX - 2,
    y: frameY - 2,
    width: frameWidth + 4,
    height: frameHeight + 4,
    color: pdfColor("gold"),
    opacity: 0.85,
  });

  if (image) {
    drawImageInside(page, image, frameX, frameY, frameWidth, frameHeight);
  } else {
    drawSymbolicScenePanel(page, frameX, frameY, frameWidth, frameHeight, pageNumber);
  }

  const textX = box.x + 48;
  const textTop = frameY - 30;
  const textBottom = box.y + 92;
  drawFittedParagraph(
    page,
    pageNumber % 2 === 0 ? fonts.bodyFont : fonts.italicFont,
    storyPage.text,
    textX,
    textTop,
    textBottom,
    box.width - 96,
  );

  drawCentered(
    page,
    fonts.bodyFont,
    `Page ${pageNumber} / ${totalPages}`,
    8,
    box.y + 34,
    pageWidth,
    pdfColor("soft"),
  );
}

function drawImageInside(
  page: PDFPage,
  image: PDFImage,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const scaled = image.scaleToFit(width, height);
  page.drawRectangle({ x, y, width, height, color: rgb(0.08, 0.035, 0.01), opacity: 0.96 });
  page.drawImage(image, {
    x: x + width / 2 - scaled.width / 2,
    y: y + height / 2 - scaled.height / 2,
    width: scaled.width,
    height: scaled.height,
  });
}

function drawSymbolicScenePanel(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  seed: number,
): void {
  page.drawRectangle({ x, y, width, height, color: rgb(0.09, 0.04, 0.012) });
  page.drawCircle({
    x: x + width * 0.5,
    y: y + height * 0.56,
    size: height * 0.34,
    color: rgb(0.7, 0.18, 0.07),
    opacity: 0.42,
  });
  for (let i = 0; i < 7; i += 1) {
    page.drawCircle({
      x: x + 24 + pseudoRandom(seed * 31 + i) * (width - 48),
      y: y + 24 + pseudoRandom(seed * 53 + i) * (height - 48),
      size: 1.8 + pseudoRandom(seed * 71 + i) * 2.8,
      color: pdfColor("gold"),
      opacity: 0.52,
    });
  }
  page.drawSvgPath(
    `M ${x + width * 0.18} ${y + height * 0.24} C ${x + width * 0.28} ${y + height * 0.58}, ${x + width * 0.72} ${y + height * 0.58}, ${x + width * 0.82} ${y + height * 0.24}`,
    { borderColor: pdfColor("gold"), borderWidth: 2.1, opacity: 0.68 },
  );
}

function drawFittedParagraph(
  page: PDFPage,
  font: PDFFont,
  text: string,
  x: number,
  topY: number,
  bottomY: number,
  maxWidth: number,
): void {
  let fontSize = 10;
  let lineHeight = 15;
  let lines = wrapPdfText(text, font, fontSize, maxWidth);

  while (lines.length * lineHeight > topY - bottomY && fontSize > 8.2) {
    fontSize -= 0.4;
    lineHeight = fontSize * 1.45;
    lines = wrapPdfText(text, font, fontSize, maxWidth);
  }

  const maxLines = Math.max(1, Math.floor((topY - bottomY) / lineHeight));
  const visibleLines = lines.slice(0, maxLines);
  if (visibleLines.length < lines.length && visibleLines.length > 0) {
    const last = visibleLines[visibleLines.length - 1] ?? "";
    visibleLines[visibleLines.length - 1] = `${last.replace(/[.,;:]?$/, "")}...`;
  }

  let y = topY;
  visibleLines.forEach((line) => {
    page.drawText(line, {
      x,
      y,
      size: fontSize,
      font,
      color: pdfColor("ink"),
    });
    y -= lineHeight;
  });
}

function drawScene(page: PDFPage, width: number, height: number): void {
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.055, 0.024, 0.006) });
  for (let i = 0; i < 18; i += 1) {
    page.drawCircle({
      x: width * 0.42,
      y: height * 0.64,
      size: width * (0.76 - i * 0.032),
      color: rgb(0.165, 0.083, 0.024),
      opacity: 0.025,
    });
  }
}

function drawRod(page: PDFPage, x: number, y: number, width: number, height: number): void {
  const bands = [
    { c: rgb(0.91, 0.72, 0.29), o: 1 },
    { c: rgb(0.54, 0.32, 0.05), o: 0.95 },
    { c: rgb(0.76, 0.48, 0.13), o: 0.95 },
    { c: rgb(0.48, 0.26, 0.04), o: 0.95 },
    { c: rgb(0.89, 0.66, 0.19), o: 1 },
  ];
  const bandH = height / bands.length;
  bands.forEach((band, index) => {
    page.drawRectangle({
      x,
      y: y + index * bandH,
      width,
      height: bandH + 0.5,
      color: band.c,
      opacity: band.o,
    });
  });
  page.drawCircle({ x: x - 4, y: y + height / 2, size: 17, color: rgb(0.69, 0.47, 0.11) });
  page.drawCircle({ x: x + width + 4, y: y + height / 2, size: 17, color: rgb(0.69, 0.47, 0.11) });
  page.drawCircle({
    x: x - 8,
    y: y + height / 2 + 5,
    size: 6,
    color: rgb(0.96, 0.82, 0.44),
    opacity: 0.65,
  });
  page.drawCircle({
    x: x + width,
    y: y + height / 2 + 5,
    size: 6,
    color: rgb(0.96, 0.82, 0.44),
    opacity: 0.65,
  });
}

function drawCurl(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
  direction: "top" | "bottom",
): void {
  const colors =
    direction === "top"
      ? [rgb(0.6, 0.36, 0.06), rgb(0.78, 0.53, 0.16), rgb(0.88, 0.69, 0.33)]
      : [rgb(0.88, 0.69, 0.33), rgb(0.78, 0.53, 0.16), rgb(0.6, 0.36, 0.06)];
  const bandH = height / colors.length;
  colors.forEach((color, index) => {
    page.drawRectangle({ x, y: y + index * bandH, width, height: bandH + 0.5, color });
  });
}

function drawParchmentBody(
  page: PDFPage,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const bands = 32;
  for (let i = 0; i < bands; i += 1) {
    const t = i / (bands - 1);
    page.drawRectangle({
      x,
      y: y + (height / bands) * i,
      width,
      height: height / bands + 0.6,
      color: parchmentGradient(t),
    });
  }

  for (let lineY = y + 27; lineY < y + height - 16; lineY += 27) {
    page.drawLine({
      start: { x: x + 18, y: lineY },
      end: { x: x + width - 18, y: lineY + pseudoJitter(lineY) },
      color: rgb(0.63, 0.43, 0.12),
      opacity: 0.07,
      thickness: 0.45,
    });
  }

  page.drawRectangle({ x, y, width: 50, height, color: rgb(0.35, 0.16, 0.0), opacity: 0.12 });
  page.drawRectangle({
    x: x + width - 50,
    y,
    width: 50,
    height,
    color: rgb(0.35, 0.16, 0.0),
    opacity: 0.1,
  });
  page.drawRectangle({
    x,
    y: y + height - 46,
    width,
    height: 46,
    color: rgb(0.35, 0.16, 0.0),
    opacity: 0.1,
  });
  page.drawRectangle({ x, y, width, height: 46, color: rgb(0.35, 0.16, 0.0), opacity: 0.1 });

  const ragged = raggedRectPath(x, y, width, height);
  page.drawSvgPath(ragged, { borderColor: rgb(0.54, 0.28, 0.06), borderWidth: 1.1, opacity: 0.58 });
  page.drawRectangle({
    x: x + 22,
    y: y + 22,
    width: width - 44,
    height: height - 44,
    borderColor: rgb(0.77, 0.52, 0.15),
    borderWidth: 0.55,
    opacity: 0.42,
  });
}

function parchmentGradient(t: number): ReturnType<typeof rgb> {
  type ColorStop = [number, [number, number, number]];
  const stops: ColorStop[] = [
    [0, [0.941, 0.875, 0.627]],
    [0.2, [0.91, 0.8, 0.502]],
    [0.4, [0.957, 0.894, 0.659]],
    [0.55, [0.867, 0.753, 0.439]],
    [0.72, [0.929, 0.847, 0.596]],
    [1, [0.941, 0.875, 0.627]],
  ];
  let left: ColorStop = stops[0]!;
  let right: ColorStop = stops[stops.length - 1]!;
  for (let i = 0; i < stops.length - 1; i += 1) {
    const current = stops[i]!;
    const next = stops[i + 1]!;
    if (t >= current[0] && t <= next[0]) {
      left = current;
      right = next;
      break;
    }
  }
  const span = right[0] - left[0] || 1;
  const k = (t - left[0]) / span;
  return rgb(
    left[1][0] + (right[1][0] - left[1][0]) * k,
    left[1][1] + (right[1][1] - left[1][1]) * k,
    left[1][2] + (right[1][2] - left[1][2]) * k,
  );
}

function raggedRectPath(x: number, y: number, width: number, height: number): string {
  const top = raggedEdge(x, y + height, x + width, y + height, false, 17);
  const right = raggedEdge(x + width, y + height, x + width, y, true, 18).slice(1);
  const bottom = raggedEdge(x + width, y, x, y, false, 19).slice(1);
  const left = raggedEdge(x, y, x, y + height, true, 20).slice(1);
  return `${top} ${right} ${bottom} ${left} Z`;
}

function raggedEdge(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  vertical: boolean,
  seed: number,
): string {
  const steps = vertical ? 18 : 22;
  const points: string[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const baseX = x1 + (x2 - x1) * t;
    const baseY = y1 + (y2 - y1) * t;
    const jitter = (pseudoRandom(seed + i * 31) * 2 - 1) * 3.8;
    const chip =
      pseudoRandom(seed + i * 47) > 0.82
        ? (pseudoRandom(seed + i * 53) * 2 + 1) * Math.sign(jitter || 1)
        : 0;
    const px = baseX + (vertical ? jitter + chip : 0);
    const py = baseY + (vertical ? 0 : jitter + chip);
    points.push(`${i === 0 ? "M" : "L"} ${px.toFixed(1)} ${py.toFixed(1)}`);
  }
  return points.join(" ");
}

function drawWaxSeal(page: PDFPage, x: number, y: number, size: number, font: PDFFont): void {
  page.drawCircle({ x, y, size: size + 5, color: rgb(0.42, 0.0, 0.0), opacity: 0.38 });
  page.drawCircle({
    x: x - 4,
    y: y + 2,
    size: size + 1,
    color: rgb(0.67, 0.07, 0.03),
    opacity: 0.96,
  });
  page.drawCircle({
    x: x + 5,
    y: y - 3,
    size: size - 2,
    color: rgb(0.48, 0.02, 0.01),
    opacity: 0.92,
  });
  page.drawCircle({
    x,
    y,
    size: size - 8,
    borderColor: pdfColor("gold"),
    borderWidth: 1.2,
    opacity: 0.8,
  });
  drawCentered(page, font, "TA", 12, y - 4, x * 2, pdfColor("gold"));
}

function pseudoJitter(value: number): number {
  return (pseudoRandom(value) - 0.5) * 3;
}

function pseudoRandom(value: number): number {
  const x = Math.sin(value + 1) * 43758.5453;
  return x - Math.floor(x);
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

function drawCenteredFit(
  page: PDFPage,
  font: PDFFont,
  text: string,
  size: number,
  y: number,
  pageWidth: number,
  maxWidth: number,
  color: ReturnType<typeof rgb>,
): void {
  let fontSize = size;
  const safe = normalizePdfText(text);

  while (font.widthOfTextAtSize(safe, fontSize) > maxWidth && fontSize > 14) {
    fontSize -= 1;
  }

  page.drawText(safe, {
    x: pageWidth / 2 - font.widthOfTextAtSize(safe, fontSize) / 2,
    y,
    size: fontSize,
    font,
    color,
  });
}

async function embedPdfImage(
  doc: PDFDocument,
  image?: GeneratedArtefact,
): Promise<PDFImage | null> {
  if (!image) return null;

  try {
    if (image.contentType.includes("jpeg") || image.extension.toLowerCase() === "jpg") {
      return await doc.embedJpg(image.bytes);
    }

    return await doc.embedPng(image.bytes);
  } catch {
    return null;
  }
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
