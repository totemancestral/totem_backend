import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { textPayloadSchema } from "./totem.schemas";
import { allowedTotemAnimalNames, selectTotemAnimal, TotemAnimal } from "./totem-animals";
import { normalizeTotemTitle } from "./totem-name";
import {
  buildAdultV3Context,
  buildAdultV3FallbackPayload,
  buildAdultV3GenerationPrompt,
  normalizeAdultV3Response,
} from "./totem-v3-pipeline";
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

  constructor(config: ConfigService) {
    this.anthropicApiKey = config.getOrThrow<string>("ANTHROPIC_API_KEY");
    this.anthropicModel = config.getOrThrow<string>("ANTHROPIC_MODEL");
    this.openAiApiKey = config.getOrThrow<string>("OPENAI_API_KEY");
    this.openAiImageModel = config.getOrThrow<string>("OPENAI_IMAGE_MODEL");
    this.openAiTtsModel = config.getOrThrow<string>("OPENAI_TTS_MODEL");
    this.openAiTtsVoice = config.getOrThrow<string>("OPENAI_TTS_VOICE");
    this.storyPageCount = Math.min(config.get<number>("TOTEM_STORY_PAGE_COUNT") ?? 5, 5);
  }

  async generateText(payload: TextRequest): Promise<TotemTextPayload> {
    const context = buildAdultV3Context(payload);
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
          max_tokens: 5_000,
          temperature: 0.85,
          system:
            "Tu es le moteur V3 de TOTEM ANCESTRAL. Reponds uniquement en JSON strict valide, sans Markdown.",
          messages: [
            {
              role: "user",
              content: buildAdultV3GenerationPrompt(context),
            },
          ],
        }),
      },
      240_000,
    );

    await assertOk(response, "anthropic_text");
    const json = anthropicResponseSchema.parse(await response.json());
    const content = json.content
      .map((block) => block.text)
      .filter((text): text is string => typeof text === "string" && text.length > 0)
      .join("\n")
      .trim();

    try {
      return normalizeAdultV3Response(parseJsonObject(content), context);
    } catch {
      return buildAdultV3FallbackPayload(context);
    }
  }

  buildStoryPages(text: TotemTextPayload): TotemStoryPage[] {
    return ensureStoryPages(text, this.storyPageCount);
  }

  buildAudioNarration(text: TotemTextPayload): string {
    return buildAudioNarration(text, this.storyPageCount);
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
          prompt: buildNgilMaskTotemPrompt(payload.prompt, payload.archetypeId),
          size: "1024x1360",
          quality: "medium",
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

function buildTextSystemPrompt(
  locale?: string | null,
  storyPageCount = 5,
  selectedAnimal?: TotemAnimal,
): string {
  const language = locale?.startsWith("en") ? "anglais" : "francais";
  const animalName = selectedAnimal?.name ?? "animal selectionne";
  const people = selectedAnimal?.people ?? "peuple inspirant africain";
  const region = selectedAnimal?.region ?? "Afrique";
  const quality = selectedAnimal?.quality ?? "presence";

  return `Tu es le moteur editorial de TOTEM ANCESTRAL, une maison de creation artistique.

Tu crees une oeuvre artistique et symbolique a partir de dix reponses utilisateur. Ce n'est pas de la genealogie, ni de la science, ni de la divination. C'est une fable.

Reponds uniquement avec un objet JSON valide, sans Markdown, sans commentaire, avec exactement ces cles :
{
  "archetypeId": "${selectedAnimal?.slug ?? "slug-court-en-minuscules"}",
  "ancestralName": "Nom ancestral compose unique au format [Prenom A]-[Prenom B], [Titre poetique]",
  "parchmentText": "Parchemin Ancestral de 1500 a 1800 caracteres, 5 mouvements separes par doubles sauts de ligne",
  "audioMessage": "Script audio de 130 a 160 mots, pret pour voix synthetique",
  "imagePrompt": "Prompt image Ngil detaille, sans texte dans l'image",
  "storyPages": [
    { "page": 1, "title": "L'Ouverture", "text": "Mouvement 1 isole", "imagePrompt": "Prompt image de ce mouvement, sans texte dans l'image" }
  ]
}

Contraintes :
- Langue de sortie : ${language}.
- Ton : plume de griot, mystique, intime, noble, jamais caricatural.
- Liste autorisee des archetypes : ${allowedTotemAnimalNames()}.
- L'archetype central obligatoire est : ${animalName}. Tu ne dois choisir aucun autre animal central.
- Peuple inspirant : ${people} (${region}). Qualite principale : ${quality}.
- archetypeId : exactement "${selectedAnimal?.slug ?? "slug-court-en-minuscules"}".
- ancestralName : nom compose unique. Il doit aller au-dela du simple animal.
- parchmentText : 1500 a 1800 caracteres espaces compris, structure en 5 mouvements.
- Mouvements obligatoires : L'Ouverture, Le Portrait, L'Epreuve, La Transmission, Le Passage.
- storyPages : exactement ${storyPageCount} objets, numerotes de 1 a ${storyPageCount}, reprenant les mouvements du parchemin.
- Si ${storyPageCount} > 5, les pages supplementaires prolongent le meme recit sans changer d'archetype.
- Chaque storyPages[i].imagePrompt : meme totem sous forme de portrait ancestral coupe en deux, moitie gauche visage realiste de l'animal totem, moitie droite masque Ngil Fang stylise, sans typographie ni mot visible.
- audioMessage : 130 a 160 mots, phrases courtes, pauses avec "..." ou retours ligne, ton pose, grave et doux.
- imagePrompt : prompt descriptif en langage naturel (pas de parametres --ar/--stylize/--v), format visuel : Portrait ancestral puissant, visage coupe en deux : moitie gauche visage realiste de ${animalName}, moitie droite masque Ngil Fang traditionnel africain stylise avec yeux blancs et motifs geometriques, fusion harmonieuse au milieu du visage, peau avec cicatrices rituelles dorees, ambiance sombre mystique, eclairage dramatique cinematographique, style artistique premium africain, tres detaille, haute resolution, cadrage vertical 3:4.
- Interdits : texte visible dans l'image, logos, watermark, verite scientifique ou ethnique, divination, emojis.`;
}

function buildTextUserPrompt(payload: TextRequest, selectedAnimal: TotemAnimal): string {
  const name = payload.customerName?.trim() || "cette personne";
  const answers = payload.answers
    .map((answer, index) => `${index + 1}. ${answer.questionId}: ${answer.answer}`)
    .join("\n");

  return `Commande: ${payload.orderId}
Utilisateur: ${payload.userId}
Prenom ou nom: ${name}

Reponses du parcours initiatique :
${answers}

Animal totem impose par le moteur de selection : ${selectedAnimal.name}.

Compose maintenant le JSON final du coffret TOTEM ANCESTRAL.`;
}

function enforceSelectedAnimal(
  text: TotemTextPayload,
  selectedAnimal: TotemAnimal,
): TotemTextPayload {
  const name = selectedAnimal.name;
  const ancestralName = normalizeTotemTitle(text.ancestralName, name);
  const instruction = `Animal totem obligatoire et reconnaissable: ${name}.`;

  return {
    ...text,
    archetypeId: selectedAnimal.slug,
    ancestralName,
    imagePrompt: `${instruction} ${text.imagePrompt}`,
    storyPages: text.storyPages.map((page) => ({
      ...page,
      imagePrompt: `${instruction} ${page.imagePrompt}`,
    })),
  };
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
  return text.audioMessage.trim() || text.parchmentText.slice(0, 1400);
}



function buildNgilMaskTotemPrompt(prompt: string, archetypeId: string): string {
  const leftFace = animalLeftFace(archetypeId);

  // Le rendu doit passer pour une photographie prise en studio, pas pour une
  // image generee : d'ou une direction strictement photographique (appareil,
  // optique, lumiere, matiere de peau) et un negatif qui exclut explicitement
  // les signatures du rendu synthetique.
  return [
    prompt,
    `Mandatory subject: a real photographic portrait of one person, face split in two — left half ${leftFace}, right half an authentic hand-carved Fang Ngil wooden mask with aged white kaolin pigment, visible tool marks, worn patina and real wood grain.`,
    "Organic transition down the middle of the face: skin meets wood with no hard seam, no cut-out or collage effect.",
    "Real skin: visible pores, fine hair, natural texture and slight asymmetry, subtle blemishes, no retouching, no smoothing.",
    "Lighting: one natural side light source with soft falloff, deep but unsaturated shadows, no rim glow, no lens flare, no artificial halo.",
    "Camera: medium format, 85mm lens at f/2.8, shallow depth of field, natural colour depth, fine analog grain.",
    "Palette: deep black #0D0D1A, ancestral gold #C9A84C, ochre, indigo, ivory. Vertical 3:4 close-up framing.",
    "Avoid absolutely: 3D render, CGI, digital painting, illustration, concept art, airbrushed or waxy plastic skin, glossy highlights, oversaturation, HDR halo, perfect symmetry, over-sharpening, glowing eyes, beauty-filter look.",
    "Do not generate text, letters, logos, watermark, labels, UI, modern objects or cartoon style.",
  ]
    .filter(Boolean)
    .join("\n");
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

  return `Illustrate page ${page} of a long ancestral story: the same totem ${text.ancestralName} appears as a split-face Ngil ancestral portrait in ${realm}, left half realistic animal face, right half stylized Fang Ngil mask, golden ritual scarifications, dramatic cinematic light, premium African artwork, no text, no typography.`;
}

function animalLeftFace(archetypeId: string): string {
  const labels: Record<string, string> = {
    lion: "visage de lion realiste avec criniere noire et regard percant",
    lionne: "visage de lionne realiste avec regard protecteur et traits royaux",
    rhinoceros: "visage de rhinoceros realiste avec corne sculpturale et peau minerale",
    crocodile: "visage de crocodile realiste avec ecailles profondes et regard ancien",
    serpent: "visage de serpent realiste avec ecailles vert sombre et regard hypnotique",
    dauphin: "visage de dauphin realiste avec peau bleutee et regard lumineux",
    elephant: "visage d'elephant realiste avec defenses sculpturales et regard ancestral",
    baobab: "visage anthropomorphe de baobab realiste avec ecorce massive et racines sculptees",
    zebre: "visage de zebre realiste avec rayures nettes et regard calme",
    perroquet: "visage de perroquet realiste avec plumage vert et or et regard vif",
    aigle: "visage d'aigle realiste avec bec royal et regard percant",
    leopard: "visage de leopard realiste avec taches sombres et regard precis",
    python: "visage de python realiste avec ecailles profondes et regard ancien",
    panthere: "visage de panthere noire realiste avec regard precis et silhouette d'ombre",
    guepard: "visage de guepard realiste avec marques lacrymales et regard rapide",
    hyene: "visage de hyene realiste avec machoire puissante et regard inquietant",
    buffle: "visage de buffle realiste avec cornes massives et regard ancre",
    hippopotame: "visage d'hippopotame realiste avec peau sombre et puissance tranquille",
    girafe: "visage de girafe realiste avec motifs ocres et regard eleve",
    gorille: "visage de gorille realiste avec front puissant et regard profond",
    chimpanze: "visage de chimpanze realiste avec regard vif et intelligence calme",
    faucon: "visage de faucon realiste avec bec tranchant et regard libre",
    tortue: "visage de tortue realiste avec carapace ancienne et regard patient",
    "grue-couronnee": "visage de grue couronnee realiste avec couronne doree et regard elegant",
  };

  if (labels[archetypeId]) return labels[archetypeId];
  const readable = archetypeId.replace(/-/g, " ");
  return `visage realiste du totem ${readable} avec details anatomiques precis et regard ancestral`;
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

type PdfCopy = {
  subtitle: string;
  holder: (name: string) => string;
  holderFallback: string;
  offer: string;
  order: string;
  story: string;
  page: string;
  insignia: string;
  offers: Record<string, string>;
};

/**
 * Libelles du parchemin. Le recit est genere dans la langue du client : les
 * mentions du gabarit doivent suivre, sinon un parchemin anglais s'ouvre sur
 * « Decret royal de revelation symbolique ».
 */
function pdfCopy(locale?: string | null): PdfCopy {
  if (locale?.startsWith("en")) {
    return {
      subtitle: "Royal decree of symbolic revelation",
      holder: (name) => `Prepared for ${name}`,
      holderFallback: "A personal and unique work",
      offer: "Offer",
      order: "Order",
      story: "THE STORY",
      page: "Page",
      insignia: "INSIGNIA",
      offers: { origine: "ORIGIN", ancestral: "REVELATION", famille: "FAMILY", junior: "JUNIOR" },
    };
  }

  return {
    subtitle: "Decret royal de revelation symbolique",
    holder: (name) => `Prepare pour ${name}`,
    holderFallback: "Oeuvre personnelle et unique",
    offer: "Offre",
    order: "Commande",
    story: "LE RECIT",
    page: "Page",
    insignia: "INSIGNE",
    offers: { origine: "ORIGINE", ancestral: "REVELATION", famille: "FAMILLE", junior: "JUNIOR" },
  };
}

async function renderTotemPdf(payload: PdfRequest): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const width = 595;
  const height = 842;
  const titleFont = await doc.embedFont(StandardFonts.TimesRomanBold);
  const bodyFont = await doc.embedFont(StandardFonts.TimesRoman);
  const italicFont = await doc.embedFont(StandardFonts.TimesRomanItalic);
  const manuscriptFont = await loadManuscriptFont(doc);

  const copy = pdfCopy(payload.locale);
  const parchment = await loadParchmentBackground(doc);

  const firstPage = doc.addPage([width, height]);
  const firstBox = drawRoyalParchment(firstPage, width, height, parchment);
  drawCentered(firstPage, titleFont, "TOTEM ANCESTRAL", 24, height - 102, width, pdfColor("ink"));
  drawCentered(
    firstPage,
    italicFont,
    copy.subtitle,
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

  const titleHeight = drawCenteredFit(
    firstPage,
    titleFont,
    normalizePdfText(payload.text.ancestralName).toUpperCase(),
    28,
    titleY,
    width,
    width - 112,
    pdfColor("ink"),
  );
  const titleBottomY = titleY - titleHeight + 28;

  const holder = payload.customerName
    ? copy.holder(payload.customerName)
    : copy.holderFallback;
  drawCentered(firstPage, bodyFont, holder, 12, titleBottomY - 33, width, pdfColor("soft"));
  drawWaxSeal(firstPage, width / 2, firstBox.y + 74, 26, titleFont);
  drawCentered(
    firstPage,
    bodyFont,
    `${copy.offer}: ${copy.offers[payload.offer] ?? payload.offer.toUpperCase()}`,
    10,
    firstBox.y + 118,
    width,
    pdfColor("goldDark"),
  );
  firstPage.drawText(`${copy.order}: ${payload.orderId}`, {
    x: firstBox.x + 18,
    y: firstBox.y + 24,
    size: 8,
    font: bodyFont,
    color: pdfColor("soft"),
  });

  const storyPageCount = Math.max(1, payload.text.storyPages.length || 20);
  const storyPages = ensureStoryPages(payload.text, storyPageCount);

  drawStoryFlow(doc, {
    width,
    height,
    titleFont,
    bodyFont,
    italicFont,
    manuscriptFont,
    text: payload.text,
    storyPages,
    parchment,
    copy,
  });

  return doc.save();
}

function drawStoryFlow(
  doc: PDFDocument,
  input: {
    width: number;
    height: number;
    titleFont: PDFFont;
    bodyFont: PDFFont;
    italicFont: PDFFont;
    manuscriptFont: PDFFont | null;
    text: TotemTextPayload;
    storyPages: TotemStoryPage[];
    parchment: PDFImage | null;
    copy: PdfCopy;
  },
): void {
  const sections = buildStorySections(input.text, input.storyPages);
  let pageNumber = 1;
  let cursor = createStoryContentPage(doc, input, pageNumber);

  // Le parchemin livré ne doit jamais dépasser 3 pages (page de garde incluse).
  const MAX_PARCHMENT_PAGES = 3;
  let stopped = false;
  const tryNewPage = (): boolean => {
    if (doc.getPageCount() >= MAX_PARCHMENT_PAGES) return false;
    pageNumber += 1;
    cursor = createStoryContentPage(doc, input, pageNumber);
    return true;
  };

  for (const section of sections) {
    if (stopped) break;
    const titleSize = 10;
    const titleLines = wrapPdfText(
      section.title.toUpperCase(),
      input.titleFont,
      titleSize,
      cursor.maxWidth - 24,
    );
    const neededTitleHeight = titleLines.length * 13 + 8;
    if (cursor.y - neededTitleHeight < cursor.bottomY && !tryNewPage()) {
      stopped = true;
      break;
    }

    for (const titleLine of titleLines) {
      cursor.page.drawText(titleLine, {
        x:
          cursor.textX +
          cursor.maxWidth / 2 -
          input.titleFont.widthOfTextAtSize(titleLine, titleSize) / 2,
        y: cursor.y,
        size: titleSize,
        font: input.titleFont,
        color: pdfColor("goldDark"),
      });
      cursor.y -= 13;
    }
    cursor.y -= 4;

    const paragraphs = section.text
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);

    for (const paragraph of paragraphs) {
      if (stopped) break;
      const paragraphFont =
        input.manuscriptFont ?? (section.index % 2 === 0 ? input.italicFont : input.bodyFont);
      const paragraphSize = input.manuscriptFont ? 12.2 : 9.4;
      const paragraphLineHeight = input.manuscriptFont ? 17.2 : 14;
      const lines = wrapPdfText(
        paragraph,
        paragraphFont,
        paragraphSize,
        cursor.maxWidth,
        Boolean(input.manuscriptFont),
      );

      for (const line of lines) {
        if (cursor.y - paragraphLineHeight < cursor.bottomY && !tryNewPage()) {
          stopped = true;
          break;
        }

        cursor.page.drawText(line, {
          x: cursor.textX,
          y: cursor.y,
          size: paragraphSize,
          font: paragraphFont,
          color: pdfColor("ink"),
        });
        cursor.y -= paragraphLineHeight;
      }

      cursor.y -= 7;
    }

    cursor.y -= 8;
  }

  // Sceau final : nouvelle page uniquement si le plafond n'est pas atteint,
  // sinon on remonte le curseur pour le poser en bas de la dernière page.
  if (cursor.y - 80 < cursor.bottomY) {
    if (doc.getPageCount() < MAX_PARCHMENT_PAGES) {
      pageNumber += 1;
      cursor = createStoryContentPage(doc, input, pageNumber);
    } else {
      cursor.y = cursor.bottomY + 80;
    }
  }

  drawCentered(
    cursor.page,
    input.titleFont,
    input.copy.insignia,
    15,
    cursor.y,
    input.width,
    pdfColor("ink"),
  );
  cursor.y -= 30;
  drawWaxSeal(cursor.page, input.width / 2, cursor.y, 23, input.titleFont);
}

async function loadManuscriptFont(doc: PDFDocument): Promise<PDFFont | null> {
  const localPaths = [
    join(process.cwd(), "assets/fonts/DancingScript-Regular.ttf"),
    join(process.cwd(), "public/fonts/totem/DancingScript-Regular.ttf"),
    join(process.cwd(), "dist/assets/fonts/DancingScript-Regular.ttf"),
  ];

  for (const localPath of localPaths) {
    try {
      const bytes = await readFile(localPath);
      return await doc.embedFont(bytes, { subset: true });
    } catch {
      // Try the next known deployment layout before falling back to the public site.
    }
  }

  for (const remoteUrl of manuscriptFontUrls()) {
    try {
      const bytes = await fetchManuscriptFontBytes(remoteUrl);
      return await doc.embedFont(bytes, { subset: true });
    } catch {
      // Keep trying candidate URLs; a final concise error is logged below.
    }
  }

  console.error("[pdf] manuscript font unavailable", {
    localPaths,
    remoteUrls: manuscriptFontUrls(),
  });
  return null;
}

async function fetchManuscriptFontBytes(remoteUrl: string): Promise<Uint8Array> {
  const response = await fetch(remoteUrl, {
    cache: "force-cache",
    headers: { Accept: "text/css,*/*" },
  });
  if (!response.ok) throw new Error(`font_fetch_${response.status}`);

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/css") || remoteUrl.includes("fonts.googleapis.com")) {
    const css = await response.text();
    const fontUrl = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/)?.[1];
    if (!fontUrl) throw new Error("font_css_url_missing");

    const fontResponse = await fetch(fontUrl, { cache: "force-cache" });
    if (!fontResponse.ok) throw new Error(`font_binary_fetch_${fontResponse.status}`);
    return new Uint8Array(await fontResponse.arrayBuffer());
  }

  return new Uint8Array(await response.arrayBuffer());
}

function manuscriptFontUrls(): string[] {
  return [
    "https://fonts.googleapis.com/css2?family=Dancing+Script:wght@400;500;600;700&display=swap",
  ];
}

function createStoryContentPage(
  doc: PDFDocument,
  input: {
    width: number;
    height: number;
    titleFont: PDFFont;
    bodyFont: PDFFont;
    parchment: PDFImage | null;
    copy: PdfCopy;
  },
  pageNumber: number,
): { page: PDFPage; textX: number; y: number; bottomY: number; maxWidth: number } {
  const page = doc.addPage([input.width, input.height]);
  const box = drawRoyalParchment(page, input.width, input.height, input.parchment);

  drawCentered(
    page,
    input.titleFont,
    input.copy.story,
    16,
    input.height - 102,
    input.width,
    pdfColor("goldDark"),
  );
  drawCentered(
    page,
    input.bodyFont,
    "--- * ---",
    10,
    input.height - 124,
    input.width,
    pdfColor("goldDark"),
  );

  // Le totem n'est illustré qu'une seule fois, en page de garde : les pages de
  // recit restent du texte manuscrit sur parchemin (cf. totem-parchemin/).
  const y = input.height - 156;

  drawCentered(
    page,
    input.bodyFont,
    `${input.copy.page} ${pageNumber}`,
    8,
    box.y + 34,
    input.width,
    pdfColor("soft"),
  );

  return {
    page,
    textX: box.x + 48,
    y,
    bottomY: box.y + 78,
    maxWidth: box.width - 96,
  };
}


function buildStorySections(
  text: TotemTextPayload,
  storyPages: TotemStoryPage[],
): Array<{ index: number; title: string; text: string }> {
  return [
    { index: 0, title: "Prologue", text: text.parchmentText },
    ...storyPages.map((page, index) => ({
      index: index + 1,
      title: page.title,
      text: page.text,
    })),
  ].filter((section) => section.text.trim().length > 0);
}

/**
 * Charge le parchemin (rouleau ouvert avec ses tringles) servant de fond aux
 * pages. Même stratégie de chemins que la police manuscrite ; en cas d'absence
 * de l'asset, le rendu retombe sur le parchemin vectoriel.
 */
async function loadParchmentBackground(doc: PDFDocument): Promise<PDFImage | null> {
  const localPaths = [
    join(process.cwd(), "assets/parchemin_ouvert.png"),
    join(process.cwd(), "dist/assets/parchemin_ouvert.png"),
  ];

  for (const localPath of localPaths) {
    try {
      return await doc.embedPng(await readFile(localPath));
    } catch {
      // Layout de déploiement suivant.
    }
  }

  return null;
}

function drawRoyalParchment(
  page: PDFPage,
  width: number,
  height: number,
  background: PDFImage | null,
): { x: number; y: number; width: number; height: number } {
  const scrollWidth = Math.min(470, width - 82);
  const x = width / 2 - scrollWidth / 2;
  const topRodY = height - 82;
  const bottomRodY = 46;
  const rodHeight = 26;
  const curlHeight = 22;
  const bodyY = bottomRodY + rodHeight + curlHeight;
  const bodyH = topRodY - bodyY - curlHeight;

  // Le parchemin réel occupe toute la page ; la zone d'écriture reste celle du
  // rouleau vectoriel pour conserver la mise en page (texte posé sur le papier,
  // jamais sur les tringles).
  if (background) {
    page.drawImage(background, { x: 0, y: 0, width, height });
    return { x, y: bodyY, width: scrollWidth, height: bodyH };
  }

  drawScene(page, width, height);
  drawRod(page, x, topRodY, scrollWidth, rodHeight);
  drawRod(page, x, bottomRodY, scrollWidth, rodHeight);
  drawCurl(page, x, topRodY - curlHeight, scrollWidth, curlHeight, "top");
  drawCurl(page, x, bodyY - curlHeight, scrollWidth, curlHeight, "bottom");
  drawParchmentBody(page, x, bodyY, scrollWidth, bodyH);

  return { x, y: bodyY, width: scrollWidth, height: bodyH };
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
): number {
  let fontSize = size;
  const safe = normalizePdfText(text);
  let lines = wrapPdfText(safe, font, fontSize, maxWidth);

  while (
    (lines.length > 2 || lines.some((line) => font.widthOfTextAtSize(line, fontSize) > maxWidth)) &&
    fontSize > 14
  ) {
    fontSize -= 1;
    lines = wrapPdfText(safe, font, fontSize, maxWidth);
  }

  const lineHeight = fontSize * 1.08;
  lines.forEach((line, index) => {
    page.drawText(line, {
      x: pageWidth / 2 - font.widthOfTextAtSize(line, fontSize) / 2,
      y: y - index * lineHeight,
      size: fontSize,
      font,
      color,
    });
  });

  return lines.length * lineHeight;
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
  } catch (error) {
    console.error("[pdf] image embed failed", {
      contentType: image.contentType,
      extension: image.extension,
      bytes: image.bytes.length,
      error,
    });
    return null;
  }
}

function wrapPdfText(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
  preserveDiacritics = false,
): string[] {
  const safeText = preserveDiacritics ? normalizeManuscriptPdfText(text) : normalizePdfText(text);
  const words = safeText
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => splitLongPdfWord(word, font, size, maxWidth));
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

function splitLongPdfWord(word: string, font: PDFFont, size: number, maxWidth: number): string[] {
  if (font.widthOfTextAtSize(word, size) <= maxWidth) return [word];

  const chunks: string[] = [];
  let current = "";
  for (const char of Array.from(word)) {
    const candidate = `${current}${char}`;
    if (current && font.widthOfTextAtSize(candidate, size) > maxWidth) {
      chunks.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
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

function normalizeManuscriptPdfText(value: string): string {
  return value
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/œ/g, "oe")
    .replace(/Œ/g, "OE")
    .replace(/[\x00-\x1F\x7F]/g, " ")
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
