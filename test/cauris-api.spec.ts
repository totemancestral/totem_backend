import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "../../projet-totem-ancestral/node_modules/next/server";
import { GET as state } from "../../projet-totem-ancestral/app/api/consultations/etat/route";
import { GET as history } from "../../projet-totem-ancestral/app/api/consultations/historique/route";
import { POST as draw } from "../../projet-totem-ancestral/app/api/consultations/tirer/route";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), limit: vi.fn(), env: vi.fn() }));
vi.mock("../../projet-totem-ancestral/lib/supabase/server", () => ({ authenticateRequest: mocks.auth }));
vi.mock("../../projet-totem-ancestral/lib/rate-limit", () => ({ rateLimit: mocks.limit }));
vi.mock("../../projet-totem-ancestral/lib/env", () => ({ getServerEnv: mocks.env }));
const fetchMock = vi.fn();
const request = (body?: unknown) => new Request("http://localhost/api/consultations/tirer", {
  headers: { Authorization: "Bearer user-token", "Content-Type": "application/json" },
  ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
});
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock);
  mocks.auth.mockResolvedValue({ userId: "owner", email: "owner@example.invalid" });
  mocks.limit.mockResolvedValue(null); mocks.env.mockReturnValue({ TOTEM_BACKEND_URL: "https://backend.example/" });
  fetchMock.mockResolvedValue(Response.json({ accessible: true, availableNow: true, currentReading: null }));
});
afterEach(() => vi.unstubAllGlobals());

describe("authenticated cauris API proxy", () => {
  it("rejects unauthenticated requests without contacting the backend", async () => {
    mocks.auth.mockResolvedValue(NextResponse.json({ error: "unauthenticated" }, { status: 401 }));
    expect((await state(request())).status).toBe(401); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("forwards the actual session and disables caching of personal readings", async () => {
    const result = await state(request());
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(fetchMock).toHaveBeenCalledWith("https://backend.example/consultations/etat", expect.objectContaining({ cache: "no-store", headers: expect.objectContaining({ Authorization: "Bearer user-token" }) }));
  });
  it("forwards mood but strips a client-supplied user identifier", async () => {
    await draw(request({ mood: "en_doute", userId: "someone-else" }));
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: "POST", body: JSON.stringify({ mood: "en_doute" }) }));
    expect(mocks.limit).toHaveBeenCalledWith(expect.anything(), 10, 60000, "cauris.draw");
  });
  it("rejects unsupported moods before drawing", async () => {
    expect((await draw(request({ mood: "invalid" }))).status).toBe(422); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("only relays a valid history cursor", async () => {
    expect((await history(new Request("http://localhost/api/consultations/historique?before=invalid"))).status).toBe(422);
    await history(new Request("http://localhost/api/consultations/historique?before=2026-10-19", { headers: { Authorization: "Bearer user-token" } }));
    expect(fetchMock).toHaveBeenCalledWith("https://backend.example/consultations/historique?before=2026-10-19", expect.anything());
  });
  it("preserves the work-required state and hides unrelated backend errors", async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ message: "oeuvre_required" }, { status: 403 }));
    expect(await (await draw(request({}))).json()).toEqual({ error: "oeuvre_required" });
    fetchMock.mockResolvedValueOnce(Response.json({ message: "Internal database detail" }, { status: 500 }));
    expect(await (await state(request())).json()).toEqual({ error: "consultation_unavailable" });
  });
});
