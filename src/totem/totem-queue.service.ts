import { randomUUID } from "node:crypto";
import { Injectable, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Redis } from "@upstash/redis";
import { TOTEM_QUEUE } from "./totem.constants";

const KEYS = ["queue", "processing", "started", "owners"].map((name) => `${TOTEM_QUEUE}:${name}`);
export const TOTEM_QUEUE_STALE_MS = 20 * 60 * 1000;
export interface TotemJob { orderId: string; token: string }

// Les opérations touchant plusieurs clés sont indivisibles entre instances.
export const QUEUE_SCRIPTS = {
  enqueue: `
    if redis.call('LPOS', KEYS[1], ARGV[1]) or redis.call('LPOS', KEYS[2], ARGV[1]) then return 0 end
    redis.call('LPUSH', KEYS[1], ARGV[1])
    return 1`,
  dequeue: `
    while true do
      local id = redis.call('RPOP', KEYS[1])
      if not id then return false end
      if not redis.call('LPOS', KEYS[2], id) then
        redis.call('LPUSH', KEYS[2], id)
        redis.call('HSET', KEYS[3], id, ARGV[2])
        redis.call('HSET', KEYS[4], id, ARGV[1])
        return id
      end
    end`,
  heartbeat: `
    if redis.call('HGET', KEYS[4], ARGV[1]) ~= ARGV[2] then return 0 end
    redis.call('HSET', KEYS[3], ARGV[1], ARGV[3])
    return 1`,
  finish: `
    if redis.call('HGET', KEYS[4], ARGV[1]) ~= ARGV[2] then return 0 end
    redis.call('LREM', KEYS[2], 0, ARGV[1])
    redis.call('HDEL', KEYS[3], ARGV[1])
    redis.call('HDEL', KEYS[4], ARGV[1])
    if ARGV[3] == 'retry' then
      redis.call('LREM', KEYS[1], 0, ARGV[1])
      redis.call('LPUSH', KEYS[1], ARGV[1])
    end
    return 1`,
  reclaim: `
    local reclaimed = 0
    for _, id in ipairs(redis.call('LRANGE', KEYS[2], 0, -1)) do
      local started = tonumber(redis.call('HGET', KEYS[3], id) or '0')
      if started <= tonumber(ARGV[1]) and redis.call('LREM', KEYS[2], 0, id) > 0 then
        redis.call('HDEL', KEYS[3], id)
        redis.call('HDEL', KEYS[4], id)
        redis.call('LREM', KEYS[1], 0, id)
        redis.call('LPUSH', KEYS[1], id)
        reclaimed = reclaimed + 1
      end
    end
    return reclaimed`,
};

@Injectable()
export class TotemQueueService implements OnModuleInit {
  private readonly redis: Redis;
  private readonly redisUrl: string;
  private readonly redisToken: string;

  constructor(config: ConfigService) {
    this.redisUrl = config.getOrThrow<string>("UPSTASH_REDIS_URL").replace(/\/$/, "");
    this.redisToken = config.getOrThrow<string>("UPSTASH_REDIS_TOKEN");
    this.redis = new Redis({
      url: this.redisUrl,
      token: this.redisToken,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.redis.ping();
      await this.reclaimStale();
    } catch {
      // Le worker retentera la connexion lors du prochain passage.
    }
  }

  async checkAvailability(): Promise<void> {
    const response = await fetch(this.redisUrl, {
      method: "POST",
      signal: AbortSignal.timeout(3_000),
      headers: { Authorization: `Bearer ${this.redisToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(["PING"]),
    });
    if (!response.ok) throw new Error("queue_unavailable");
    const payload = await response.json();
    if (payload?.result !== "PONG" || payload?.error) throw new Error("queue_unavailable");
  }

  async enqueue(orderId: string): Promise<void> {
    await this.redis.eval(QUEUE_SCRIPTS.enqueue, KEYS, [orderId]);
  }

  async dequeue(): Promise<TotemJob | null> {
    const token = randomUUID();
    const orderId = await this.redis.eval<unknown[], string | null>(QUEUE_SCRIPTS.dequeue, KEYS, [token, Date.now()]);
    return orderId ? { orderId, token } : null;
  }

  async heartbeat(job: TotemJob): Promise<boolean> {
    return await this.redis.eval<unknown[], number>(QUEUE_SCRIPTS.heartbeat, KEYS, [job.orderId, job.token, Date.now()]) === 1;
  }

  async ack(job: TotemJob): Promise<void> {
    await this.redis.eval(QUEUE_SCRIPTS.finish, KEYS, [job.orderId, job.token, "ack"]);
  }

  async retry(job: TotemJob): Promise<void> {
    await this.redis.eval(QUEUE_SCRIPTS.finish, KEYS, [job.orderId, job.token, "retry"]);
  }

  async reclaimStale(): Promise<number> {
    return this.redis.eval<unknown[], number>(QUEUE_SCRIPTS.reclaim, KEYS, [Date.now() - TOTEM_QUEUE_STALE_MS]);
  }

  async getJobCounts(): Promise<{ waiting: number; active: number }> {
    const [waiting, active] = await Promise.all([this.redis.llen(KEYS[0]!), this.redis.llen(KEYS[1]!)]);
    return { waiting, active };
  }
}
