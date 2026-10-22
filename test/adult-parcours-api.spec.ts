import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as saveProgress } from "../../projet-totem-ancestral/app/api/parcours/route";
import { POST as complete } from "../../projet-totem-ancestral/app/api/orders/complete/route";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), db: vi.fn(), draft: vi.fn(), payment: vi.fn(), limit: vi.fn() }));
vi.mock("../../projet-totem-ancestral/lib/supabase/server", () => ({ authenticateRequest: mocks.auth, createServiceClient: mocks.db }));
vi.mock("../../projet-totem-ancestral/lib/server/adult-parcours", () => ({ readAdultDraft: mocks.draft, readAdultPayment: mocks.payment }));
vi.mock("../../projet-totem-ancestral/lib/rate-limit", () => ({ rateLimit: mocks.limit }));

const parcoursId = "00000000-0000-4000-8000-000000000002";
const sessionId = "cs_test_1";
const answers = (count: number) => Object.fromEntries(Array.from({ length: count }, (_, i) => [String(i + 1), { choice: "A" }]));
const request = (body: unknown) => new Request("http://localhost/api/parcours", {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer test" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ userId: "user-1", email: "test@example.invalid" });
  mocks.limit.mockResolvedValue(null);
  mocks.draft.mockResolvedValue({ id: parcoursId, termine: false, command: { id: "command-1", stripe_session_id: sessionId } });
  mocks.payment.mockResolvedValue({ paid: false });
});

describe("adult progress API enforcement", () => {
  it("rejects saving a fifth answer without verified payment before touching the database", async () => {
    const response = await saveProgress(request({ parcoursId, answers: answers(5), locale: "fr" }));
    expect(response.status).toBe(402);
    expect(mocks.db).not.toHaveBeenCalled();
  });

  it("rejects creating an unpaid draft containing later answers", async () => {
    const response = await saveProgress(request({ answers: answers(5), locale: "fr" }));
    expect(response.status).toBe(402);
    expect(mocks.payment).not.toHaveBeenCalled();
    expect(mocks.db).not.toHaveBeenCalled();
  });

  it("looks up the draft under the authenticated owner and rejects missing or mismatched sessions", async () => {
    mocks.draft.mockResolvedValue(null);
    const response = await saveProgress(request({ parcoursId, sessionId, answers: answers(4), locale: "fr" }));
    expect(response.status).toBe(404);
    expect(mocks.draft).toHaveBeenCalledWith("user-1", parcoursId, sessionId);
    expect(mocks.db).not.toHaveBeenCalled();
  });

  it("keeps completed drafts immutable", async () => {
    mocks.draft.mockResolvedValue({ id: parcoursId, termine: true });
    const response = await saveProgress(request({ parcoursId, answers: answers(4), locale: "fr" }));
    expect(response.status).toBe(409);
    expect(mocks.db).not.toHaveBeenCalled();
  });

  it("saves four answers as an unfinished, independent draft", async () => {
    const insert = vi.fn();
    const table = { insert, select: vi.fn(), single: vi.fn().mockResolvedValue({ data: { id: parcoursId }, error: null }) };
    insert.mockReturnValue(table); table.select.mockReturnValue(table);
    mocks.db.mockReturnValue({ from: () => table });
    const response = await saveProgress(request({ answers: answers(4), locale: "fr" }));
    expect(response.status).toBe(200);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ user_id: "user-1", termine: false, session_id: expect.any(String) }));
    expect((await response.json()).parcoursId).toBe(parcoursId);
  });
});

describe("adult completion API enforcement", () => {
  it("rejects finalizing four answers", async () => {
    const response = await complete(request({ parcoursId, sessionId, answers: answers(4), locale: "en" }));
    expect(response.status).toBe(422);
    expect(mocks.draft).not.toHaveBeenCalled();
  });

  it("rejects ten answers when payment is still unconfirmed", async () => {
    const response = await complete(request({ parcoursId, sessionId, answers: answers(10), locale: "en" }));
    expect(response.status).toBe(402);
    expect(mocks.db).not.toHaveBeenCalled();
  });

  it("does not overwrite or submit an already completed paid draft", async () => {
    mocks.draft.mockResolvedValue({ id: parcoursId, termine: true, command: { id: "command-1" } });
    mocks.payment.mockResolvedValue({ paid: true });
    const response = await complete(request({ parcoursId, sessionId, answers: answers(10), locale: "en" }));
    expect(response.status).toBe(200);
    expect(mocks.db).not.toHaveBeenCalled();
  });
});
