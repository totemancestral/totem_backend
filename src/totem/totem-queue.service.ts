import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "@upstash/redis";
import { TOTEM_QUEUE } from "./totem.constants";

const QUEUE_KEY = `${TOTEM_QUEUE}:queue`;
const PROCESSING_KEY = `${TOTEM_QUEUE}:processing`;
const STARTED_KEY = `${TOTEM_QUEUE}:started`;

/** Jobs in-flight plus anciens que ce délai sont repris (crash / hang). */
export const TOTEM_QUEUE_STALE_MS = 20 * 60 * 1000;

/**
 * File Redis crash-safe sur Upstash REST (LPUSH / LMOVE / ACK).
 * BullMQ n'est pas utilisé : Upstash est exposé en HTTP, pas en protocole Redis TCP.
 *
 * Contrat :
 * - dequeue déplace atomiquement queue -> processing (pas de trou RPOP).
 * - ack retire de processing seulement après persist (succès ou échec enregistré).
 * - reclaim au boot + jobs stale : un crash entre dequeue et ack ne perd plus le job.
 */
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
      await this.reclaimStale(0);
    } catch {
      // Redis unavailable — queue will degrade gracefully
    }
  }

  async enqueue(orderId: string, force = false): Promise<void> {
    if (force) {
      await this.redis.lrem(QUEUE_KEY, 0, orderId);
    }

    await this.redis.lpush(QUEUE_KEY, orderId);
  }

  /** Déplace atomiquement un job vers processing. Null si la file est vide. */
  async dequeue(): Promise<string | null> {
    const orderId = await this.redis.lmove(QUEUE_KEY, PROCESSING_KEY, "right", "left");
    if (!orderId) return null;
    await this.redis.hset(STARTED_KEY, { [orderId]: Date.now() });
    return orderId;
  }

  /** ACK : retirer de processing après persist (succès, retry enqueued, ou erreur finale). */
  async ack(orderId: string): Promise<void> {
    await this.redis.lrem(PROCESSING_KEY, 0, orderId);
    await this.redis.hdel(STARTED_KEY, orderId);
  }

  /** @deprecated alias de ack — conservé pour les appels existants. */
  async markDone(orderId: string): Promise<void> {
    await this.ack(orderId);
  }

  async reclaimStale(staleMs = TOTEM_QUEUE_STALE_MS): Promise<number> {
    const processing = (await this.redis.lrange<string>(PROCESSING_KEY, 0, -1)) ?? [];
    if (processing.length === 0) return 0;

    const started = ((await this.redis.hgetall<Record<string, string | number>>(STARTED_KEY)) ??
      {}) as Record<string, string | number>;
    const now = Date.now();
    let reclaimed = 0;

    for (const orderId of processing) {
      const ts = Number(started[orderId] ?? 0);
      if (staleMs > 0 && ts > 0 && now - ts < staleMs) continue;
      const stillProcessing = await this.redis.lpos(PROCESSING_KEY, orderId);
      if (stillProcessing === null) continue;
      await this.ack(orderId);
      await this.redis.lrem(QUEUE_KEY, 0, orderId);
      await this.redis.lpush(QUEUE_KEY, orderId);
      reclaimed += 1;
    }

    return reclaimed;
  }

  async getJobCounts(): Promise<{ waiting: number; active: number }> {
    const [waiting, active] = await Promise.all([
      this.redis.llen(QUEUE_KEY),
      this.redis.llen(PROCESSING_KEY),
    ]);
    return { waiting, active };
  }
}
