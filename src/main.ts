import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import WebSocket from 'ws';
import { AppModule } from './app.module';

globalThis.WebSocket ??= WebSocket as unknown as typeof globalThis.WebSocket;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });

  app.enableShutdownHooks();

  const config = app.get(ConfigService);
  const corsOrigin = config.get<string>('CORS_ORIGIN');

  if (corsOrigin) {
    app.enableCors({
      origin: corsOrigin.split(',').map((origin) => origin.trim()).filter(Boolean),
      methods: ['GET', 'POST', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'Stripe-Signature'],
    });
  }

  await app.listen(config.getOrThrow<number>('PORT'));
}

void bootstrap();
