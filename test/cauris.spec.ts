import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { ConsultationCaurisService } from "../src/totem/consultation-cauris.service";
import { caurisSerieForArchetype, drawCauris, nextParisWeekStart, parisWeekKey, restoreCaurisDraw } from "../src/totem/totem-cauris-draw";
import { CAURIS_SERIES } from "../src/totem/totem-cauris";
import { TOTEM_ANIMALS } from "../src/totem/totem-animals";

const now = new Date("2026-10-22T12:00:00Z");
const order = { id: "order-1", userId: "user-1", archetypeId: "lion", ancestralName: "Ancestor One", customerName: "Person One", locale: "fr" };
type Row = {
  id: string; userId: string; orderId: string | null; archetypeId: string; ancestralName: string | null; serie: "D2";
  imageCode: string; paroleCode: string; gesteCode: string; readingPayload: unknown; mood: string | null; weekKey: string; createdAt: Date;
};
function reading(userId = "user-1", date = now): Row {
  return { id: `reading-${userId}-${date.toISOString()}`, userId, orderId: "order-1", archetypeId: "lion", ancestralName: "Ancestor One", serie: "D2",
    imageCode: "D2-IMG01", paroleCode: "D2-PAR01", gesteCode: "D2-GES01", readingPayload: null, mood: "apaise", weekKey: parisWeekKey(date), createdAt: date };
}

function setup(initial: Row[] = []) {
  const rows = [...initial]; let profileExists = false;
  const prisma = {
    totemOrder: { findFirst: vi.fn().mockResolvedValue(order) },
    userProfile: { upsert: vi.fn(async () => { profileExists = true; return {}; }) },
    consultationReading: {
      findFirst: vi.fn(async ({ where }) => rows.find((r) => r.userId === where.userId && r.weekKey === where.weekKey) ?? null),
      findMany: vi.fn(async ({ where, take }) => rows.filter((r) => r.userId === where.userId && (!where.weekKey || r.weekKey < where.weekKey.lt)).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, take)),
      create: vi.fn(async ({ data }) => {
        if (!profileExists) throw Error("missing_profile");
        if (rows.some((r) => r.userId === data.userId && r.weekKey === data.weekKey)) {
          throw new Prisma.PrismaClientKnownRequestError("Duplicate week", { code: "P2002", clientVersion: "test" });
        }
        const row = { ...data, id: `reading-${rows.length}`, mood: data.mood ?? null } as Row;
        rows.push(row); return row;
      }),
    },
  };
  return { service: new ConsultationCaurisService(prisma as never), prisma, rows };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); });

describe("weekly cauris service", () => {
  it("only looks up the authenticated user's completed adult work", async () => {
    const { service, prisma } = setup();
    expect(await service.etat("user-1")).toMatchObject({ accessible: true, availableNow: true, currentReading: null });
    expect(prisma.totemOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ userId: "user-1", status: "done", offer: { not: "junior" } }) }));
  });

  it("rejects a new draw without a completed adult work", async () => {
    const { service, prisma } = setup(); prisma.totemOrder.findFirst.mockResolvedValue(null);
    await expect(service.tirer("user-1")).rejects.toThrow("oeuvre_required");
    expect(prisma.consultationReading.create).not.toHaveBeenCalled();
  });

  it("creates the profile before recording an adult draw and snapshots its content", async () => {
    const { service, rows, prisma } = setup();
    const result = await service.tirer("user-1", "en_doute");
    expect(result).toMatchObject({ alreadyDrawn: false, reading: { mood: "en_doute", ancestralName: "Ancestor One", language: "fr" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.readingPayload).toMatchObject({ image: expect.any(String), parole: expect.any(String), geste: expect.any(String) });
    expect(prisma.userProfile.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ id: "user-1", role: "adulte" }) }));
  });

  it("returns the recorded reading on retries and after reload", async () => {
    const { service, prisma } = setup(); const first = await service.tirer("user-1", "apaise");
    const retry = await service.tirer("user-1", "en_combat");
    expect(retry.reading).toEqual(first.reading); expect(retry.alreadyDrawn).toBe(true);
    expect((await service.etat("user-1")).currentReading).toEqual(first.reading);
    expect(prisma.consultationReading.create).toHaveBeenCalledOnce();
  });

  it("recovers the database winner when two requests race", async () => {
    const { service, rows } = setup();
    const [a, b] = await Promise.all([service.tirer("user-1", "apaise"), service.tirer("user-1", "en_combat")]);
    expect(rows).toHaveLength(1); expect(a.reading).toEqual(b.reading);
    expect([a.alreadyDrawn, b.alreadyDrawn].sort()).toEqual([false, true]);
  });

  it("allows the next Paris calendar week", async () => {
    const { service, rows } = setup(); await service.tirer("user-1");
    vi.setSystemTime(nextParisWeekStart(now));
    expect((await service.etat("user-1")).availableNow).toBe(true);
    await service.tirer("user-1"); expect(rows).toHaveLength(2);
  });

  it("never mixes another person's history into a reading or history response", async () => {
    const { service } = setup([reading("user-2")]);
    expect((await service.etat("user-1")).currentReading).toBeNull();
    expect((await service.historique("user-1")).readings).toEqual([]);
  });

  it("paginates history without exposing other users", async () => {
    const rows = Array.from({ length: 23 }, (_, i) => reading("user-1", new Date(now.getTime() - i * 7 * 86400000)));
    const { service } = setup([...rows, reading("user-2")]);
    const first = await service.historique("user-1"); const next = await service.historique("user-1", first.nextCursor!);
    expect(first.readings).toHaveLength(20); expect(next.readings).toHaveLength(3); expect(next.nextCursor).toBeNull();
    expect(new Set([...first.readings, ...next.readings].map((r) => r.id)).size).toBe(23);
  });

  it("reads legacy codes without inventing an ancestral name", async () => {
    const { service } = setup([{ ...reading(), ancestralName: null }]);
    expect((await service.historique("user-1")).readings[0]).toMatchObject({ ancestralName: null, image: CAURIS_SERIES.D2.images[0] });
  });

  it("preserves saved wording even when a code cannot be resolved", async () => {
    const { service } = setup([{ ...reading(), imageCode: "invalid", readingPayload: { image: "Saved image", parole: "Saved words", geste: "Saved action" } }]);
    expect((await service.historique("user-1")).readings[0]!.image).toBe("Saved image");
  });
});

describe("cauris banks and calendar", () => {
  it("covers every adult archetype with 20 entries per layer", () => {
    for (const animal of TOTEM_ANIMALS) expect(caurisSerieForArchetype(animal.slug)).not.toBeNull();
    for (const bank of Object.values(CAURIS_SERIES)) for (const values of [bank.images, bank.paroles, bank.gestes]) expect(values).toHaveLength(20);
  });
  it("does not repeat any layer from the last eight draws", () => {
    const history: ReturnType<typeof drawCauris>[] = [];
    for (let i = 0; i < 30; i++) {
      const pastReadings = history.filter((r): r is NonNullable<typeof r> => r !== null);
      const current = drawCauris({ archetypeId: "lion", pastReadings, random: () => 0 })!;
      for (const prior of pastReadings.slice(0, 8)) for (const key of ["imageCode", "paroleCode", "gesteCode"] as const) expect(current[key]).not.toBe(prior[key]);
      history.unshift(current);
    }
  });
  it.each(["2026-03-28T12:00:00Z", "2026-03-29T12:00:00Z", "2026-10-24T12:00:00Z", "2026-10-25T12:00:00Z", "2026-12-31T12:00:00Z"])("renews on Monday midnight Paris around %s", (value) => {
    const next = nextParisWeekStart(new Date(value));
    expect(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(next)).toBe("Monday 00:00");
  });
  it("does not replace corrupt legacy codes with a new random reading", () => {
    expect(restoreCaurisDraw({ ...reading(), imageCode: "invalid" })).toBeNull();
  });
});
