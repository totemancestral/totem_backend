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
  animalName?: string;
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
  private readonly elevenLabsApiKey?: string;
  private readonly elevenLabsVoiceId?: string;
  private readonly elevenLabsModelId: string;
  private readonly imoleApiKey?: string;
  private readonly storyPageCount: number;

  constructor(config: ConfigService) {
    this.anthropicApiKey = config.getOrThrow<string>("ANTHROPIC_API_KEY");
    this.anthropicModel = config.getOrThrow<string>("ANTHROPIC_MODEL");
    this.openAiApiKey = config.getOrThrow<string>("OPENAI_API_KEY");
    this.openAiImageModel = config.getOrThrow<string>("OPENAI_IMAGE_MODEL");
    this.openAiTtsModel = config.getOrThrow<string>("OPENAI_TTS_MODEL");
    this.openAiTtsVoice = config.getOrThrow<string>("OPENAI_TTS_VOICE");
    this.elevenLabsApiKey = config.get<string>("ELEVENLABS_API_KEY");
    this.elevenLabsVoiceId = config.get<string>("ELEVENLABS_VOICE_ID");
    this.elevenLabsModelId = config.get<string>("ELEVENLABS_MODEL_ID") ?? "eleven_v3";
    this.imoleApiKey = config.get<string>("IMOLE_API_KEY");
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
          prompt: buildNgilMaskTotemPrompt(payload.prompt, payload.archetypeId, payload.animalName),
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

  private cachedGriotVoiceId?: string;

  async generateAudio(payload: AudioRequest): Promise<GeneratedArtefact> {
    if (this.imoleApiKey) {
      try {
        return await this.generateAudioImole(payload);
      } catch (error) {
        console.error(
          `[Imole API] Audio generation failed, falling back: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    if (this.elevenLabsApiKey) {
      try {
        return await this.generateAudioElevenLabs(payload);
      } catch (error) {
        console.error(
          `[ElevenLabs] Audio generation failed, falling back to OpenAI TTS: ${error instanceof Error ? error.message : error}`,
        );
      }
    }

    return this.generateAudioOpenAi(payload);
  }

  private async generateAudioImole(payload: AudioRequest): Promise<GeneratedArtefact> {
    const voiceId = this.elevenLabsVoiceId || (await this.resolveGriotVoiceId());
    const response = await fetchWithTimeout(
      "https://api.imole.app/v1/audio/speech",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.imoleApiKey!}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.elevenLabsModelId || "eleven_v3",
          input: payload.text,
          voice_id: voiceId,
          output_format: "mp3_44100_128",
          language_code: "fr",
          stability: 0.35,
          similarity_boost: 0.85,
        }),
      },
      180_000,
    );

    await assertOk(response, "imole_audio");
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      contentType: "audio/mpeg",
      extension: "mp3",
    };
  }

  private async generateAudioElevenLabs(payload: AudioRequest): Promise<GeneratedArtefact> {
    const voiceId = await this.resolveGriotVoiceId();
    const response = await fetchWithTimeout(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": this.elevenLabsApiKey!,
          "Content-Type": "application/json",
          Accept: "audio/mpeg",
        },
        body: JSON.stringify({
          text: payload.text,
          model_id: this.elevenLabsModelId,
          voice_settings: {
            stability: 0.35,
            similarity_boost: 0.85,
            style: 0.45,
            use_speaker_boost: true,
          },
        }),
      },
      180_000,
    );

    await assertOk(response, "elevenlabs_audio");
    return {
      bytes: Buffer.from(await response.arrayBuffer()),
      contentType: "audio/mpeg",
      extension: "mp3",
    };
  }

  private async resolveGriotVoiceId(): Promise<string> {
    if (this.elevenLabsVoiceId) {
      return this.elevenLabsVoiceId;
    }

    if (this.cachedGriotVoiceId) {
      return this.cachedGriotVoiceId;
    }

    // 1. Chercher si une voix nommée Griot ou Ancestral existe déjà sur le compte
    try {
      const listResponse = await fetchWithTimeout(
        "https://api.elevenlabs.io/v1/voices",
        {
          headers: {
            "xi-api-key": this.elevenLabsApiKey!,
          },
        },
        30_000,
      );

      if (listResponse.ok) {
        const data = (await listResponse.json()) as { voices?: Array<{ voice_id: string; name: string }> };
        const existingVoice = data.voices?.find(
          (v) =>
            v.name.toLowerCase().includes("griot") ||
            v.name.toLowerCase().includes("ancestral"),
        );
        if (existingVoice?.voice_id) {
          this.cachedGriotVoiceId = existingVoice.voice_id;
          return existingVoice.voice_id;
        }
      }
    } catch {
      // Continuer vers la création automatique
    }

    // 2. Création automatique de la voix de Griot Ancestral via l'API Voice Design d'ElevenLabs
    try {
      const designResponse = await fetchWithTimeout(
        "https://api.elevenlabs.io/v1/voice-generation/generate-voice",
        {
          method: "POST",
          headers: {
            "xi-api-key": this.elevenLabsApiKey!,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            gender: "male",
            accent: "african",
            age: "old",
            accent_strength: 1.4,
            text: "Au commencement des terres anciennes, le souffle du vent portait la memoire des ancetres et des rois.",
          }),
        },
        60_000,
      );

      if (designResponse.ok) {
        const generationId =
          designResponse.headers.get("generated_voice_id") ??
          ((await designResponse.json().catch(() => ({}))) as { generated_voice_id?: string })
            ?.generated_voice_id;

        if (generationId) {
          const createResponse = await fetchWithTimeout(
            "https://api.elevenlabs.io/v1/voice-generation/create-voice",
            {
              method: "POST",
              headers: {
                "xi-api-key": this.elevenLabsApiKey!,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                voice_name: "Griot Ancestral",
                voice_description:
                  "Voix profonde, sage et chaleureuse d'un ancien griot africain narrant le recit ancestral.",
                generated_voice_id: generationId,
              }),
            },
            60_000,
          );

          if (createResponse.ok) {
            const createdData = (await createResponse.json()) as { voice_id?: string };
            if (createdData.voice_id) {
              this.cachedGriotVoiceId = createdData.voice_id;
              return createdData.voice_id;
            }
          }
        }
      }
    } catch (error) {
      console.warn(
        `[ElevenLabs] Auto voice design creation failed: ${error instanceof Error ? error.message : error}`,
      );
    }

    // 3. Fallback sur une voix de conteur masculine grave si la création automatique échoue
    const fallbackVoiceId = "JBFqnCBsd6RMkjVDRZzb";
    this.cachedGriotVoiceId = fallbackVoiceId;
    return fallbackVoiceId;
  }

  private async generateAudioOpenAi(payload: AudioRequest): Promise<GeneratedArtefact> {
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
              "Voix grave, lente, chaleureuse et posée. Diction nette, articulation soignée, prononciation française naturelle, respirations courtes et pauses marquées après les phrases fortes. Laisser le silence porter le sens sans emphase ni effet théâtral.",
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
- Ton : plume de griot, intime et noble, jamais caricatural, religieux ou divinatoire.
- Ecris une prose relue : accords, orthographe, ponctuation, enchainements logiques et vocabulaire precis. Le texte doit rester humain, sobre et singulier, sans marqueur de generation automatique.
- Liste autorisee des archetypes : ${allowedTotemAnimalNames()}.
- L'archetype central obligatoire est : ${animalName}. Tu ne dois choisir aucun autre animal central.
- Peuple inspirant : ${people} (${region}). Qualite principale : ${quality}.
- archetypeId : exactement "${selectedAnimal?.slug ?? "slug-court-en-minuscules"}".
- ancestralName : nom compose unique. Il doit aller au-dela du simple animal.
- parchmentText : 1500 a 1800 caracteres espaces compris, structure en 5 mouvements.
- Mouvements obligatoires : L'Ouverture, Le Portrait, L'Epreuve, La Transmission, Le Passage.
- N'ecris jamais le nom d'un mouvement dans parchmentText. Les mouvements s'enchainent en prose, separes par une ligne vide, sans aucun intitule.
- PONCTUATION : n'utilise JAMAIS de tiret (-) ni de tiret cadratin (—) pour separer des mots, des idees ou des phrases, ni comme incise, ni devant un numero. Emploie uniquement une ponctuation francaise correcte : virgule, point, deux-points, point-virgule, parentheses. Le tiret n'est admis qu'a l'interieur d'un mot compose (« sous-bois », « au-dela »).
- storyPages : exactement ${storyPageCount} objets, numerotes de 1 a ${storyPageCount}, reprenant les mouvements du parchemin.
- Si ${storyPageCount} > 5, les pages supplementaires prolongent le meme recit sans changer d'archetype.
- Chaque storyPages[i].imagePrompt : le meme masque Ngil ancestral, objet d'art autonome, dont les ornements evoquent l'animal totem ${animalName}. Aucun etre vivant ni sujet humain.
- audioMessage : 130 a 160 mots, phrases courtes, pauses avec "..." ou retours ligne, ton pose, grave et doux.
- imagePrompt : prompt descriptif en langage naturel (pas de parametres --ar/--stylize/--v), consacre a un masque Ngil Fang sculpte en bois, seul sujet de l'image. Le masque porte des motifs et volumes qui evoquent ${animalName}, avec une presence noble, majestueuse, glamour et precieuse, rude dans sa matiere mais jamais repoussante, palette noir profond, or ancestral, ocre, indigo et ivoire, traces d'outil, kaolin patine, eclairage d'atelier museal, cadrage vertical 3:4.
- Interdits absolus : visage humain, portrait humain, personne, silhouette humaine, corps humain, moitie de visage, collage, texte visible, logos, watermark, verite scientifique ou ethnique, divination, emojis.`;
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
  const source = text.audioMessage.trim() || text.parchmentText.trim();
  if (!source) return "";
  return source;
}



function buildNgilMaskTotemPrompt(prompt: string, archetypeId: string, animalName?: string): string {
  const animal = animalName ?? animalNameForPrompt(archetypeId);
  const source = /human|person|portrait|face|split[- ]face|animal body|living subject|personne|visage|portrait|corps humain|corps animal|moitié/i.test(prompt)
    ? ""
    : prompt.trim();

  return [
    source,
    `Mandatory subject: one authentic hand-carved Fang Ngil African wooden mask representing the ${animal} totem.`,
    `The carved wooden features, elongated geometry, chiseled reliefs, and traditional African ceremonial engravings must distinctly evoke the ${animal}, seamlessly sculpted into an authentic Fang Ngil wooden mask.`,
    "Museum-grade masterpiece of African tribal sculpture, carved from dark aged African hardwood with authentic white kaolin clay patina in the hollows, ochre pigments, and polished wood grain.",
    "Studio museum lighting on a dark minimalist pedestal, frontal 3:4 portrait view, rich wood textures, chiseled artisan tool marks, ancient ceremonial majesty, vertical 3:4 composition.",
    "No human faces, no human bodies, no living animals, no cartoon or anime, no CGI plastic look, no glowing neon, no modern elements, no text or watermarks.",
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

  return `Illustrate page ${page} with the same hand-carved Fang Ngil wooden mask, the only subject, displayed as a precious ancestral art object in ${realm}. Its ornaments evoke the totem without depicting any living being. Noble, majestic, glamorous, rugged wood, aged ivory kaolin, ancestral gold, ochre and indigo, dramatic museum light, vertical composition, no human, no animal body, no text, no typography.`;
}

function animalNameForPrompt(archetypeId: string): string {
  const names: Record<string, string> = {
    // Adultes
    lion: "lion majestueux à la crinière royale",
    lionne: "lionne puissante et protectrice",
    rhinoceros: "rhinocéros imposant aux cornes sacrées",
    crocodile: "crocodile sacré des rivières primordiales",
    serpent: "serpent sage aux écailles gravées de mystère",
    dauphin: "dauphin guide des courants anciens",
    elephant: "éléphant patriarche de force et de mémoire",
    baobab: "baobab sacré aux branches cosmiques",
    zebre: "zèbre aux lignes et zébrures rituelles",
    perroquet: "perroquet messager aux plumes sculptées",
    aigle: "aigle royal des cimes au bec acéré et regard perçant",
    leopard: "léopard agile aux tâches d'ébène et de feu",
    // Juniors
    kwame_aigle: "aigle royal aux ailes déployées et regard perçant des hautes cimes",
    dayo_lion: "lion solaire à la crinière flamboyante et regard de feu",
    aida_panthere: "panthère noire nocturne aux yeux d'ambre et agilité mystique",
    kofi_buffle: "buffle des plaines aux puissantes cornes sculptées d'endurance",
    nia_antilope: "antilope gracieuse et véloce des savanes sacrées",
    kemi_serpent: "serpent sage aux anneaux de connaissance",
    tariq_elephant: "éléphant sage gardien de la mémoire ancestrale",
    zola_guepard: "guépard rapide aux lignes fuselées de vitesse",
    amara_faucon: "faucon chasseur au regard de précision infaillible",
    malik_crocodile: "crocodile gardien des eaux profondes",
  };

  if (names[archetypeId]) return names[archetypeId];

  const parts = archetypeId.toLowerCase().split("_");
  const candidate = parts[parts.length - 1];
  return (candidate && names[candidate]) || candidate || "totem animal ancestral";
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

  // PAGE 1 : la couverture. Titre, sous-titre, filet, l'unique image du
  // totem, le nom ancestral, le destinataire et le sceau de cire.
  const firstPage = doc.addPage([width, height]);
  const cover = drawRoyalParchment(firstPage, width, height, parchment);
  const coverTop = cover.y + cover.height;

  drawCentered(
    firstPage,
    titleFont,
    "TOTEM ANCESTRAL",
    ref(40, width),
    coverTop - ref(40, width),
    width,
    pdfColor("ink"),
  );
  drawCentered(
    firstPage,
    italicFont,
    copy.subtitle,
    ref(18, width),
    coverTop - ref(70, width),
    width,
    pdfColor("soft"),
  );
  drawGoldRule(firstPage, width / 2, coverTop - ref(88, width), ref(120, width));

  let titleY = coverTop - ref(230, width);
  const coverImage = await embedPdfImage(doc, payload.image);
  if (coverImage) {
    const imageSize = ref(300, width);
    const imageX = width / 2 - imageSize / 2;
    const imageY = coverTop - ref(120, width) - imageSize;
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
    titleY = imageY - ref(52, width);
  }

  const titleHeight = drawCenteredFit(
    firstPage,
    titleFont,
    normalizePdfText(payload.text.ancestralName).toUpperCase(),
    ref(34, width),
    titleY,
    width,
    cover.width,
    pdfColor("ink"),
  );
  const titleBottomY = titleY - titleHeight + ref(34, width);

  const holder = payload.customerName
    ? copy.holder(payload.customerName)
    : copy.holderFallback;
  drawCentered(
    firstPage,
    manuscriptFont ?? bodyFont,
    holder,
    manuscriptFont ? ref(30, width) : ref(20, width),
    titleBottomY - ref(40, width),
    width,
    pdfColor("ink"),
  );

  drawWaxSeal(firstPage, width / 2, cover.y + ref(74, width), ref(45, width), titleFont);
  drawCentered(
    firstPage,
    bodyFont,
    `${copy.offer}: ${copy.offers[payload.offer] ?? payload.offer.toUpperCase()}`,
    ref(13, width),
    cover.y + ref(146, width),
    width,
    pdfColor("goldDark"),
  );
  drawCentered(
    firstPage,
    bodyFont,
    `${copy.order}: ${payload.orderId}`,
    ref(11, width),
    cover.y,
    width,
    pdfColor("soft"),
  );

  // PAGE 2 : le recit complet, sans titres de mouvements.
  drawParchmentStory(doc, {
    width,
    height,
    titleFont,
    bodyFont,
    manuscriptFont,
    movements: buildParchmentMovements(payload.text),
    parchment,
    copy,
  });

  return doc.save();
}

/** Filet dore centre, repris du document de reference. */
function drawGoldRule(page: PDFPage, centerX: number, y: number, ruleWidth: number): void {
  page.drawRectangle({
    x: centerX - ruleWidth / 2,
    y,
    width: ruleWidth,
    height: 1.4,
    color: pdfColor("goldDark"),
    opacity: 0.75,
  });
}

/**
 * Recit du parchemin : le texte complet, d'un seul tenant, sans titre de
 * mouvement.
 *
 * La page de garde porte l'image ; le recit tient sur une seule page de
 * parchemin, deux au maximum. Plutot que de couper le texte quand il deborde,
 * on reduit progressivement le corps jusqu'a ce que tout entre : le lecteur
 * recoit toujours l'integralite du recit.
 */
function drawParchmentStory(
  doc: PDFDocument,
  input: {
    width: number;
    height: number;
    titleFont: PDFFont;
    bodyFont: PDFFont;
    manuscriptFont: PDFFont | null;
    movements: string[];
    parchment: PDFImage | null;
    copy: PdfCopy;
  },
): void {
  const MAX_STORY_PAGES = 2;
  const font = input.manuscriptFont ?? input.bodyFont;
  const paragraphs = input.movements.filter((movement) => movement.trim().length > 0);
  if (paragraphs.length === 0) return;

  const box = parchmentContentBox(input.width, input.height);

  // Seule la premiere page du recit porte l'en-tete ; seule la derniere
  // reserve la place de l'insigne et du sceau.
  const headerHeight = ref(96, input.width);
  const sealHeight = ref(130, input.width);

  const layout = fitParchmentText({
    paragraphs,
    font,
    manuscript: Boolean(input.manuscriptFont),
    maxWidth: box.width,
    firstPageHeight: box.height - headerHeight,
    otherPageHeight: box.height,
    sealHeight,
    maxPages: MAX_STORY_PAGES,
  });

  // Un mouvement n'est jamais coupe entre deux pages : on remplit la premiere
  // page de mouvements entiers, le reste passe sur la seconde.
  const spread = spreadOverPages(layout, {
    firstPageHeight: box.height - headerHeight,
    otherPageHeight: box.height,
    sealHeight,
  });

  let cursor = openStoryPage(doc, input, box, headerHeight, true);

  spread.forEach((pageBlocks, pageIndex) => {
    if (pageIndex > 0) cursor = openStoryPage(doc, input, box, headerHeight, false);
    for (const block of pageBlocks) {
      for (const line of block) {
        cursor.page.drawText(line, {
          x: box.x,
          y: cursor.y,
          size: layout.fontSize,
          font,
          color: pdfColor("ink"),
        });
        cursor.y -= layout.lineHeight;
      }
      cursor.y -= layout.paragraphGap;
    }
  });

  // Insigne et sceau, poses en bas a droite de la derniere page du recit (sans chevauchement avec le texte).
  const sealRadius = ref(34, input.width);
  const sealX = box.x + box.width - sealRadius - ref(10, input.width);
  const sealY = box.y + sealRadius + ref(8, input.width);

  drawCentered(
    cursor.page,
    input.titleFont,
    input.copy.insignia,
    ref(14, input.width),
    sealY + sealRadius + ref(6, input.width),
    sealX * 2,
    pdfColor("ink"),
  );
  drawWaxSeal(
    cursor.page,
    sealX,
    sealY,
    sealRadius,
    input.titleFont,
  );
}

/**
 * Repartit les mouvements sur les pages du recit sans jamais en couper un.
 * La derniere page garde la place de l'insigne et du sceau.
 */
function spreadOverPages(
  layout: { blocks: string[][]; lineHeight: number; paragraphGap: number; pages: number },
  heights: { firstPageHeight: number; otherPageHeight: number; sealHeight: number },
): string[][][] {
  const spread: string[][][] = [[]];
  const heightOf = (index: number) =>
    index === 0 ? heights.firstPageHeight : heights.otherPageHeight;
  // Tant qu'il reste des pages autorisees, la page courante n'est pas la
  // derniere : elle n'a donc pas a reserver la place du sceau.
  const availableOn = (index: number) =>
    heightOf(index) - (index === layout.pages - 1 ? heights.sealHeight : 0);

  let pageIndex = 0;
  let remaining = availableOn(0);

  for (const block of layout.blocks) {
    const needed = block.length * layout.lineHeight + layout.paragraphGap;
    if (needed > remaining && pageIndex + 1 < layout.pages) {
      pageIndex += 1;
      spread.push([]);
      remaining = availableOn(pageIndex);
    }
    spread[pageIndex]?.push(block);
    remaining -= needed;
  }

  return spread;
}

/** Ouvre une page de recit et renvoie le curseur d'ecriture. */
function openStoryPage(
  doc: PDFDocument,
  input: { width: number; height: number; titleFont: PDFFont; parchment: PDFImage | null; copy: PdfCopy },
  box: { x: number; y: number; width: number; height: number },
  headerHeight: number,
  withHeader: boolean,
): { page: PDFPage; y: number } {
  const page = doc.addPage([input.width, input.height]);
  drawRoyalParchment(page, input.width, input.height, input.parchment);

  const top = box.y + box.height;
  if (!withHeader) return { page, y: top };

  drawCentered(
    page,
    input.titleFont,
    input.copy.story,
    ref(34, input.width),
    top - ref(34, input.width),
    input.width,
    pdfColor("ink"),
  );
  drawGoldRule(page, input.width / 2, top - ref(54, input.width), ref(120, input.width));

  return { page, y: top - headerHeight };
}

/**
 * Cherche le plus grand corps de texte qui fasse tenir l'integralite du recit
 * dans le nombre de pages autorise. Renvoie les lignes deja decoupees pour
 * eviter de refaire le calcul au moment du trace.
 */
function fitParchmentText(input: {
  paragraphs: string[];
  font: PDFFont;
  manuscript: boolean;
  maxWidth: number;
  /** Hauteur disponible sur la premiere page, en-tete deduit. */
  firstPageHeight: number;
  /** Hauteur disponible sur les pages suivantes, sans en-tete. */
  otherPageHeight: number;
  /** Place reservee a l'insigne et au sceau, sur la derniere page seulement. */
  sealHeight: number;
  maxPages: number;
}): {
  blocks: string[][];
  fontSize: number;
  lineHeight: number;
  paragraphGap: number;
  pages: number;
} {
  const startSize = input.manuscript ? 20 : 13;
  const minSize = input.manuscript ? 11 : 8.5;

  /** Hauteur de texte tenant sur `count` pages, sceau final compris. */
  const capacity = (count: number) =>
    input.firstPageHeight +
    Math.max(0, count - 1) * input.otherPageHeight -
    input.sealHeight;

  let fontSize = startSize;
  let blocks: string[][] = [];
  let lineHeight = fontSize * 1.55;
  let paragraphGap = fontSize * 0.7;
  let pages = 1;

  for (; ;) {
    lineHeight = fontSize * 1.55;
    paragraphGap = fontSize * 0.7;
    blocks = input.paragraphs.map((paragraph) =>
      wrapPdfText(paragraph, input.font, fontSize, input.maxWidth, input.manuscript),
    );
    const needed =
      blocks.reduce((total, block) => total + block.length * lineHeight, 0) +
      Math.max(0, blocks.length - 1) * paragraphGap;

    pages = 1;
    while (needed > capacity(pages) && pages < input.maxPages) pages += 1;

    if (needed <= capacity(pages) || fontSize <= minSize) break;
    fontSize -= 0.4;
  }

  return { blocks, fontSize, lineHeight, paragraphGap, pages };
}

/**
 * Decoupe le Parchemin Ancestral en mouvements.
 *
 * Le modele separe ses cinq mouvements par une ligne vide. Les intitules
 * ("Le Portrait", "L'Epreuve"...) ne doivent pas apparaitre sur le parchemin :
 * on retire donc toute ligne d'ouverture qui n'est qu'un titre de mouvement.
 * Les pages de recit renvoyees par le modele reprennent le meme texte, elles
 * ne sont pas reprises ici pour ne pas dupliquer le recit.
 */
function buildParchmentMovements(text: TotemTextPayload): string[] {
  const source = text.parchmentText.trim()
    ? text.parchmentText
    : text.storyPages.map((page) => page.text).join("\n\n");

  return source
    .split(/\n{2,}/)
    .map((movement) => stripMovementHeading(movement.trim()))
    .filter((movement) => movement.length > 0);
}

const MOVEMENT_HEADINGS = [
  "l'ouverture",
  "le portrait",
  "l'epreuve",
  "la transmission",
  "le passage",
  "prologue",
  "the opening",
  "the portrait",
  "the trial",
  "the transmission",
  "the passage",
];

function stripMovementHeading(movement: string): string {
  const lines = movement.split("\n");
  const first = (lines[0] ?? "").trim();
  const normalized = first
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/^[\s*#>-]+|[\s:.*_-]+$/g, "")
    .toLowerCase();

  // Un intitule tient sur une ligne courte et ne se termine pas par une phrase.
  if (first.length <= 40 && MOVEMENT_HEADINGS.includes(normalized)) {
    return lines.slice(1).join("\n").trim();
  }
  return movement;
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

  console.error("[pdf] manuscript font unavailable", { localPaths });
  return null;
}

async function fetchManuscriptFontBytes(remoteUrl: string): Promise<Uint8Array> {
  throw new Error(`remote_font_disabled:${remoteUrl}`);
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

/**
 * Gabarit d'une page de parchemin, transpose du document de reference
 * `totem-parchemin/components/totem/ParchmentPdfDocument.tsx` :
 * fond sombre, cadre dore, rouleau `parchemin_ouvert.png` etire sur toute la
 * zone interieure, puis une colonne de texte en retrait de 13 % en largeur et
 * de 11 % en hauteur, pour que rien ne vienne mordre sur les tringles.
 *
 * Les proportions du document de reference sont exprimees en pixels a 96 dpi
 * (794 x 1123). On les ramene ici en points PDF (595 x 842).
 */
const PARCHMENT_REFERENCE_WIDTH = 794;
const PAGE_PADDING = 26;
const FRAME_INSET = 14;
// Les bords du rouleau sont dechires : on garde un retrait un peu plus large
// que celui du document de reference pour que jamais une lettre ne tombe sur
// le vide entre deux dechirures.
const CONTENT_INSET_X = 0.16;
const CONTENT_INSET_Y = 0.125;

/** Convertit une mesure du document de reference en points PDF. */
function ref(value: number, pageWidth: number): number {
  return (value * pageWidth) / PARCHMENT_REFERENCE_WIDTH;
}

/** Colonne d'ecriture d'une page, calculee sans rien tracer. */
function parchmentContentBox(
  width: number,
  height: number,
): { x: number; y: number; width: number; height: number } {
  const padding = ref(PAGE_PADDING, width);
  const sheetWidth = width - padding * 2;
  const sheetHeight = height - padding * 2;
  const insetX = sheetWidth * CONTENT_INSET_X;
  const insetY = sheetHeight * CONTENT_INSET_Y;

  return {
    x: padding + insetX,
    y: padding + insetY,
    width: sheetWidth - insetX * 2,
    height: sheetHeight - insetY * 2,
  };
}

function drawRoyalParchment(
  page: PDFPage,
  width: number,
  height: number,
  background: PDFImage | null,
): { x: number; y: number; width: number; height: number } {
  const padding = ref(PAGE_PADDING, width);
  const frame = ref(FRAME_INSET, width);

  // Fond sombre de la page, puis le cadre dore du document de reference.
  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(0.051, 0.051, 0.071) });
  page.drawRectangle({
    x: frame,
    y: frame,
    width: width - frame * 2,
    height: height - frame * 2,
    borderColor: pdfColor("goldDark"),
    borderWidth: 1.5,
  });

  const sheetX = padding;
  const sheetY = padding;
  const sheetWidth = width - padding * 2;
  const sheetHeight = height - padding * 2;

  if (background) {
    page.drawImage(background, {
      x: sheetX,
      y: sheetY,
      width: sheetWidth,
      height: sheetHeight,
    });
  } else {
    // L'asset est indispensable au rendu voulu : sans lui on pose un papier
    // uni de la meme teinte plutot qu'un rouleau dessine qui ne respecterait
    // pas la forme attendue. La mise en page, elle, reste identique.
    console.error("[pdf] parchemin_ouvert.png introuvable, rendu sur fond uni");
    page.drawRectangle({
      x: sheetX,
      y: sheetY,
      width: sheetWidth,
      height: sheetHeight,
      color: rgb(0.898, 0.843, 0.729),
    });
  }

  return parchmentContentBox(width, height);
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
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeManuscriptPdfText(value: string): string {
  return value
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
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
