import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import { textPayloadSchema } from './totem.schemas';
import {
  GeneratedArtefact,
  QuestionnaireAnswer,
  TotemTextPayload,
} from './totem.types';

type TextRequest = {
  orderId: string;
  userId: string;
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
  locale?: string | null;
  text: TotemTextPayload;
  answers: QuestionnaireAnswer[];
};

const artefactJsonSchema = z
  .object({
    url: z.string().url().optional(),
    base64: z.string().min(1).optional(),
    contentType: z.string().min(1).optional(),
    extension: z.string().min(1).optional(),
  })
  .refine((value) => value.url || value.base64, 'artefact_payload_missing');

@Injectable()
export class TotemMicroservicesClient {
  private readonly textUrl: string;
  private readonly imageUrl: string;
  private readonly audioUrl: string;
  private readonly pdfUrl: string;
  private readonly apiKey: string;

  constructor(config: ConfigService) {
    this.textUrl = config.getOrThrow<string>('TOTEM_TEXT_API_URL');
    this.imageUrl = config.getOrThrow<string>('TOTEM_IMAGE_API_URL');
    this.audioUrl = config.getOrThrow<string>('TOTEM_AUDIO_API_URL');
    this.pdfUrl = config.getOrThrow<string>('TOTEM_PDF_API_URL');
    this.apiKey = config.getOrThrow<string>('TOTEM_MICROSERVICE_API_KEY');
  }

  async generateText(payload: TextRequest): Promise<TotemTextPayload> {
    const response = await this.post(this.textUrl, payload, 90_000);
    const json = await response.json();

    return textPayloadSchema.parse(json);
  }

  async generateImage(payload: ImageRequest): Promise<GeneratedArtefact> {
    const response = await this.post(this.imageUrl, payload, 240_000);

    return this.readArtefact(response, 'image/png', 'png');
  }

  async generateAudio(payload: AudioRequest): Promise<GeneratedArtefact> {
    const response = await this.post(this.audioUrl, payload, 240_000);

    return this.readArtefact(response, 'audio/mpeg', 'mp3');
  }

  async generatePdf(payload: PdfRequest): Promise<GeneratedArtefact> {
    const response = await this.post(
      this.pdfUrl,
      {
        orderId: payload.orderId,
        userId: payload.userId,
        locale: payload.locale,
        archetype_id: payload.text.archetypeId,
        nom_ancestral: payload.text.ancestralName,
        texte_parchemin: payload.text.parchmentText,
        message_audio: payload.text.audioMessage,
        prompt_image: payload.text.imagePrompt,
        answers: payload.answers,
      },
      240_000,
    );

    return this.readArtefact(response, 'application/pdf', 'pdf');
  }

  private async post(
    url: string,
    payload: unknown,
    timeoutMs: number,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw new Error(`microservice_failed:${response.status}:${detail.slice(0, 300)}`);
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readArtefact(
    response: Response,
    fallbackContentType: string,
    fallbackExtension: string,
  ): Promise<GeneratedArtefact> {
    const contentType = response.headers.get('content-type') ?? fallbackContentType;

    if (contentType.includes('application/json')) {
      const payload = artefactJsonSchema.parse(await response.json());

      if (payload.url) {
        return this.downloadArtefact(
          payload.url,
          payload.contentType ?? fallbackContentType,
          payload.extension ?? fallbackExtension,
        );
      }

      return {
        bytes: Buffer.from(payload.base64 ?? '', 'base64'),
        contentType: payload.contentType ?? fallbackContentType,
        extension: payload.extension ?? fallbackExtension,
      };
    }

    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType,
      extension: extensionFromContentType(contentType) ?? fallbackExtension,
    };
  }

  private async downloadArtefact(
    url: string,
    fallbackContentType: string,
    fallbackExtension: string,
  ): Promise<GeneratedArtefact> {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`artefact_download_failed:${response.status}`);
    }

    const contentType = response.headers.get('content-type') ?? fallbackContentType;

    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType,
      extension: extensionFromContentType(contentType) ?? fallbackExtension,
    };
  }
}

function extensionFromContentType(contentType: string): string | undefined {
  const clean = contentType.split(';')[0]?.trim();

  if (clean === 'image/png') return 'png';
  if (clean === 'image/jpeg') return 'jpg';
  if (clean === 'audio/mpeg') return 'mp3';
  if (clean === 'audio/wav') return 'wav';
  if (clean === 'application/pdf') return 'pdf';

  return undefined;
}
