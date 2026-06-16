import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from './prisma/prisma.service';
import { TOTEM_QUEUE } from './totem/totem.constants';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(TOTEM_QUEUE)
    private readonly queue: Queue,
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
      await this.queue.getJobCounts('waiting', 'active', 'delayed', 'failed');

      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('service_unavailable');
    }
  }
}
