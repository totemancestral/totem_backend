import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { envSchema } from './config/env.schema';
import { TotemModule } from './totem/totem.module';
import { APP_FILTER } from '@nestjs/core';
import { PublicErrorFilter } from './public-error.filter';

@Module({
  providers: [{ provide: APP_FILTER, useClass: PublicErrorFilter }],
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: (raw) => envSchema.parse(raw),
    }),
    TotemModule,
  ],
})
export class AppModule {}
