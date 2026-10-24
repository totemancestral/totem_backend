import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Redis } from "@upstash/redis";
import { QUEUE_SCRIPTS, TOTEM_QUEUE_STALE_MS } from "../src/totem/totem-queue.service";

// Opt-in uniquement : ne lit jamais les identifiants Redis de l'application.
const url = process.env.TOTEM_TEST_REDIS_REST_URL;
const token = process.env.TOTEM_TEST_REDIS_REST_TOKEN;
describe.skipIf(!url || !token)("isolated Redis queue integration", () => {
  let redis: Redis;
  let keys: string[];
  const run = <T>(script: string, args: unknown[]) => redis.eval<unknown[], T>(script, keys, args);
  beforeEach(() => {
    redis = new Redis({ url: url!, token: token! });
    const prefix = `{totem-queue-test:${randomUUID()}}`;
    keys = ["queue", "processing", "started", "owners"].map((key) => `${prefix}:${key}`);
  });
  afterEach(async () => { await redis.del(...keys); });

  it("deduplicates simultaneous publications", async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => run<number>(QUEUE_SCRIPTS.enqueue, ["order"])));
    expect(results.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(await redis.llen(keys[0]!)).toBe(1);
  });
  it("assigns one job to only one of two competing workers", async () => {
    await run(QUEUE_SCRIPTS.enqueue, ["order"]);
    const results = await Promise.all(["a", "b"].map((owner) => run<string | null>(QUEUE_SCRIPTS.dequeue, [owner, Date.now()])));
    expect(results.filter((id) => id === "order")).toHaveLength(1);
    expect(await redis.llen(keys[1]!)).toBe(1);
  });
  it("ignores obsolete acknowledgements and heartbeats", async () => {
    await run(QUEUE_SCRIPTS.enqueue, ["order"]);
    await run(QUEUE_SCRIPTS.dequeue, ["owner", Date.now()]);
    expect(await run(QUEUE_SCRIPTS.finish, ["order", "obsolete", "ack"])).toBe(0);
    expect(await run(QUEUE_SCRIPTS.heartbeat, ["order", "obsolete", Date.now()])).toBe(0);
    expect(await redis.llen(keys[1]!)).toBe(1);
  });
  it("does not reclaim a long-running job with a renewed lease", async () => {
    await run(QUEUE_SCRIPTS.enqueue, ["order"]);
    await run(QUEUE_SCRIPTS.dequeue, ["owner", Date.now() - TOTEM_QUEUE_STALE_MS - 1]);
    await run(QUEUE_SCRIPTS.heartbeat, ["order", "owner", Date.now()]);
    expect(await run(QUEUE_SCRIPTS.reclaim, [Date.now() - TOTEM_QUEUE_STALE_MS])).toBe(0);
  });
  it("reclaims a crashed worker once and fences its old token", async () => {
    await run(QUEUE_SCRIPTS.enqueue, ["order"]);
    await run(QUEUE_SCRIPTS.dequeue, ["old", Date.now() - TOTEM_QUEUE_STALE_MS - 1]);
    const results = await Promise.all([1, 2].map(() => run<number>(QUEUE_SCRIPTS.reclaim, [Date.now() - TOTEM_QUEUE_STALE_MS])));
    expect(results.reduce((sum, count) => sum + count, 0)).toBe(1);
    await run(QUEUE_SCRIPTS.dequeue, ["new", Date.now()]);
    expect(await run(QUEUE_SCRIPTS.finish, ["order", "old", "ack"])).toBe(0);
    expect(await redis.hget(keys[3]!, "order")).toBe("new");
  });
  it("atomically retries once even if the request is repeated", async () => {
    await run(QUEUE_SCRIPTS.enqueue, ["order"]);
    await run(QUEUE_SCRIPTS.dequeue, ["owner", Date.now()]);
    const results = await Promise.all([1, 2].map(() => run<number>(QUEUE_SCRIPTS.finish, ["order", "owner", "retry"])));
    expect(results.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(await redis.llen(keys[0]!)).toBe(1);
    expect(await redis.llen(keys[1]!)).toBe(0);
  });
  it("discards legacy duplicates without replacing an active owner", async () => {
    await redis.lpush(keys[0]!, "order", "order", "next");
    expect(await run(QUEUE_SCRIPTS.dequeue, ["first", Date.now()])).toBe("order");
    expect(await run(QUEUE_SCRIPTS.dequeue, ["second", Date.now()])).toBe("next");
    expect(await redis.hget(keys[3]!, "order")).toBe("first");
  });
});
