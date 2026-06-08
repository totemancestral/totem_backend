import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { RedisOptions } from 'ioredis';
import { envSchema } from './config/env.schema';
import { PrismaModule } from './prisma/prisma.module';
import { TotemModule } from './totem/totem.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (raw) => envSchema.parse(raw),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: readRedisOptions(config.getOrThrow<string>('REDIS_URL')),
      }),
    }),
    PrismaModule,
    TotemModule,
  ],
})
export class AppModule {}

function readRedisOptions(redisUrl: string): RedisOptions {
  const url = new URL(redisUrl);
  const db = Number(url.pathname.replace('/', '') || 0);

  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  };
}
