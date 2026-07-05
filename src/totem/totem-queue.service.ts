import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "@upstash/redis";
import { TOTEM_QUEUE } from "./totem.constants";

@Injectable()
export class TotemQueueService implements OnModuleInit {
  private readonly redis: Redis;

  constructor(private readonly config: ConfigService) {
    this.redis = new Redis({
      url: this.config.getOrThrow<string>("UPSTASH_REDIS_URL"),
      token: this.config.getOrThrow<string>("UPSTASH_REDIS_TOKEN"),
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.redis.ping();
    } catch {
      // Redis unavailable — queue will degrade gracefully
    }
  }

  async enqueue(orderId: string, force = false): Promise<void> {
    if (force) {
      const active = await this.redis.sismember(
        `${TOTEM_QUEUE}:active`,
        orderId,
      );
      if (!active) {
        await this.redis.lrem(`${TOTEM_QUEUE}:queue`, 0, orderId);
      }
    }

    await this.redis.lpush(`${TOTEM_QUEUE}:queue`, orderId);
  }

  async dequeue(): Promise<string | null> {
    return this.redis.rpop(`${TOTEM_QUEUE}:queue`);
  }

  async markActive(orderId: string): Promise<void> {
    await this.redis.sadd(`${TOTEM_QUEUE}:active`, orderId);
  }

  async markDone(orderId: string): Promise<void> {
    await this.redis.srem(`${TOTEM_QUEUE}:active`, orderId);
  }

  async getJobCounts(): Promise<{ waiting: number; active: number }> {
    const [waiting, active] = await Promise.all([
      this.redis.llen(`${TOTEM_QUEUE}:queue`),
      this.redis.scard(`${TOTEM_QUEUE}:active`),
    ]);
    return { waiting, active };
  }
}
