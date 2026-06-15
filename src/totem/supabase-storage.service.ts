import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createHmac, timingSafeEqual } from 'crypto';
import { Readable } from 'stream';
import { SIGNED_URL_TTL_SECONDS } from './totem.constants';
import { GeneratedArtefact, StoredArtefact } from './totem.types';

type SignedPayload = {
  key: string;
  exp: number;
};

type ReadObject = {
  body: Readable;
  contentType: string;
  contentLength?: number;
};

@Injectable()
export class SupabaseStorageService {
  private readonly supabase: SupabaseClient;
  private readonly bucket: string;
  private readonly signingSecret: string;
  private readonly publicAssetBaseUrl: string;

  constructor(config: ConfigService) {
    this.supabase = createClient(
      config.getOrThrow<string>('SUPABASE_URL'),
      config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
    this.bucket = config.getOrThrow<string>('SUPABASE_STORAGE_BUCKET');
    this.signingSecret = config.getOrThrow<string>('DELIVERY_SIGNING_SECRET');
    this.publicAssetBaseUrl = config
      .getOrThrow<string>('PUBLIC_ASSET_BASE_URL')
      .replace(/\/$/, '');
  }

  async store(
    orderId: string,
    kind: 'image' | 'audio' | 'pdf',
    artefact: GeneratedArtefact,
  ): Promise<StoredArtefact> {
    const key = [
      'orders',
      orderId,
      `${kind}-${Date.now()}.${artefact.extension}`,
    ].join('/');

    const { error } = await this.supabase.storage.from(this.bucket).upload(
      key,
      Buffer.from(artefact.bytes),
      {
        contentType: artefact.contentType,
        upsert: true,
      },
    );

    if (error) {
      throw new Error(`supabase_storage_upload_failed:${error.message}`);
    }

    return {
      key,
      url: this.signDeliveryUrl(key),
    };
  }

  async readSignedObject(token: string): Promise<ReadObject> {
    const { key } = this.verifyToken(token);
    const { data, error } = await this.supabase.storage.from(this.bucket).download(key);

    if (error || !data) {
      throw new NotFoundException('artefact_not_found');
    }

    const bytes = Buffer.from(await data.arrayBuffer());

    return {
      body: Readable.from([bytes]),
      contentType: data.type || 'application/octet-stream',
      contentLength: bytes.byteLength,
    };
  }

  signDeliveryUrl(key: string): string {
    const exp = Math.floor(Date.now() / 1000) + SIGNED_URL_TTL_SECONDS;
    const payload = Buffer.from(JSON.stringify({ key, exp })).toString('base64url');
    const signature = this.sign(payload);

    return `${this.publicAssetBaseUrl}/totem-assets/${payload}.${signature}`;
  }

  private verifyToken(token: string): SignedPayload {
    const [payload, signature] = token.split('.');

    if (!payload || !signature || !this.hasValidSignature(payload, signature)) {
      throw new ForbiddenException('signed_url_invalid');
    }

    const signedPayload = readSignedPayload(payload);

    if (signedPayload.exp < Math.floor(Date.now() / 1000)) {
      throw new ForbiddenException('signed_url_expired');
    }

    return signedPayload;
  }

  private hasValidSignature(payload: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(payload), 'base64url');
    const received = Buffer.from(signature, 'base64url');

    return expected.length === received.length && timingSafeEqual(expected, received);
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.signingSecret).update(payload).digest('base64url');
  }
}

function readSignedPayload(payload: string): SignedPayload {
  let value: unknown;

  try {
    value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
  } catch {
    throw new ForbiddenException('signed_url_invalid');
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as SignedPayload).key === 'string' &&
    typeof (value as SignedPayload).exp === 'number'
  ) {
    return value as SignedPayload;
  }

  throw new ForbiddenException('signed_url_invalid');
}
