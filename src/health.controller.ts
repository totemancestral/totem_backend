import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { TotemQueueService } from './totem/totem-queue.service';
import { TotemWorker } from './totem/totem.worker';

@Controller()
export class RootController {
  @Get()
  root(): { status: string; service: string; message: string } {
    return {
      status: 'ok',
      service: 'totem-backend',
      message: 'TOTEM ANCESTRAL API is running.',
    };
  }
}

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: TotemQueueService,
    private readonly worker: TotemWorker,
  ) {}

  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready(): Promise<{ status: 'ok' }> {
    try {
      if (!this.worker.isAvailable()) throw new Error('worker_unavailable');
      await Promise.all([
        this.queue.checkAvailability(),
        this.prisma.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT 1 FROM "TotemOrder" LIMIT 1`;
          await tx.$queryRaw`SELECT 1 FROM "TotemPipelineError" LIMIT 1`;
          await tx.$queryRaw`SELECT 1 FROM "ConsultationReading" LIMIT 1`;
        }, { maxWait: 1_000, timeout: 4_000 }),
      ]);

      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('service_unavailable');
    }
  }
}
