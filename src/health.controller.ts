import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
  ) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ok' }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      await this.prisma.$queryRaw`SELECT 1 FROM "TotemOrder" LIMIT 1`;
      await this.prisma.$queryRaw`SELECT 1 FROM "TotemPipelineError" LIMIT 1`;

      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('service_unavailable');
    }
  }
}