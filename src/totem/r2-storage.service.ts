import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { Readable } from 'stream';
import { ReadableStream } from 'stream/web';
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
export class R2StorageService {
  private readonly endpoint: URL;
  private readonly bucket: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly signingSecret: string;
  private readonly publicAssetBaseUrl: string;

  constructor(config: ConfigService) {
    this.endpoint = new URL(config.getOrThrow<string>('R2_ENDPOINT'));
    this.bucket = config.getOrThrow<string>('R2_BUCKET');
    this.accessKeyId = config.getOrThrow<string>('R2_ACCESS_KEY_ID');
    this.secretAccessKey = config.getOrThrow<string>('R2_SECRET_ACCESS_KEY');
    this.signingSecret = config.getOrThrow<string>('R2_SIGNING_SECRET');
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

    const response = await this.sendR2Request({
      method: 'PUT',
      key,
      body: artefact.bytes,
      contentType: artefact.contentType,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`r2_upload_failed:${response.status}:${detail.slice(0, 300)}`);
    }

    return {
      key,
      url: this.signDeliveryUrl(key),
    };
  }

  async readSignedObject(token: string): Promise<ReadObject> {
    const { key } = this.verifyToken(token);

    const response = await this.sendR2Request({
      method: 'GET',
      key,
    });

    if (!response.ok || !response.body) {
      throw new NotFoundException('artefact_not_found');
    }

    const length = response.headers.get('content-length');

    return {
      body: Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
      contentType: response.headers.get('content-type') ?? 'application/octet-stream',
      contentLength: length ? Number(length) : undefined,
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

  private async sendR2Request(input: {
    method: 'GET' | 'PUT';
    key: string;
    body?: Uint8Array;
    contentType?: string;
  }): Promise<Response> {
    const now = new Date();
    const amzDate = toAmzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const path = `/${encodeR2Path(this.bucket)}/${encodeR2Path(input.key)}`;
    const url = new URL(path, this.endpoint);
    const payloadHash = hash(input.body ?? new Uint8Array());
    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };

    if (input.contentType) {
      headers['content-type'] = input.contentType;
    }

    const authorization = this.createR2Authorization({
      method: input.method,
      path,
      headers,
      payloadHash,
      dateStamp,
      amzDate,
    });

    return fetch(url, {
      method: input.method,
      headers: {
        ...headers,
        Authorization: authorization,
      },
      body: input.body ? Buffer.from(input.body) : undefined,
    });
  }

  private createR2Authorization(input: {
    method: string;
    path: string;
    headers: Record<string, string>;
    payloadHash: string;
    dateStamp: string;
    amzDate: string;
  }): string {
    const signedHeaders = Object.keys(input.headers).sort().join(';');
    const canonicalHeaders = Object.entries(input.headers)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${key}:${value.trim()}`)
      .join('\n');
    const scope = `${input.dateStamp}/auto/s3/aws4_request`;
    const canonicalRequest = [
      input.method,
      input.path,
      '',
      `${canonicalHeaders}\n`,
      signedHeaders,
      input.payloadHash,
    ].join('\n');
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      input.amzDate,
      scope,
      hash(Buffer.from(canonicalRequest)),
    ].join('\n');
    const signingKey = r2SigningKey(
      this.secretAccessKey,
      input.dateStamp,
      'auto',
      's3',
    );
    const signature = hmac(signingKey, stringToSign, 'hex');

    return [
      `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${scope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(', ');
  }
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function encodeR2Path(path: string): string {
  return path
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function hash(payload: Uint8Array): string {
  return createHash('sha256').update(payload).digest('hex');
}

function hmac(
  key: string | Uint8Array,
  value: string,
  encoding?: 'hex',
): Uint8Array | string {
  const digest = createHmac('sha256', key).update(value);

  return encoding ? digest.digest(encoding) : digest.digest();
}

function r2SigningKey(
  secret: string,
  dateStamp: string,
  region: string,
  service: string,
): Uint8Array {
  const dateKey = hmac(`AWS4${secret}`, dateStamp) as Uint8Array;
  const regionKey = hmac(dateKey, region) as Uint8Array;
  const serviceKey = hmac(regionKey, service) as Uint8Array;

  return hmac(serviceKey, 'aws4_request') as Uint8Array;
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
