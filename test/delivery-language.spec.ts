import { afterEach, describe, expect, it, vi } from "vitest";
import { PDFDocument, PDFName, PDFPage, PDFString } from "pdf-lib";
import { ResendMailerService } from "../src/totem/resend-mailer.service";
import { TotemAiService } from "../src/totem/totem-ai.service";
import { computeReveal } from "../src/totem/junior.service";

const mocks = vi.hoisted(() => ({ template: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ from: () => {
  let locale = "fr";
  const query = { select: () => query, eq: (key: string, value: string) => { if (key === "locale") locale = value; return query; }, maybeSingle: () => mocks.template(locale) };
  return query;
} }) }));
const config = (optional: Record<string, string> = {}) => ({ getOrThrow: () => "test-only", get: (key: string) => optional[key] });
const delivery = (locale: string) => ({ order: { id: "test-order", locale, customerEmail: "test@example.invalid", ancestralName: "Name <unsafe>" }, imageUrl: "https://example.invalid/image", audioUrl: null, pdfUrl: "https://example.invalid/pdf", certificateUrl: "https://example.invalid/certificate" });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("delivery language", () => {
  it.each(["fr", "en"])("renders the %s delivery fallback without real email calls", async locale => {
    mocks.template.mockResolvedValue({ data: null, error: null });
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", fetchMock);
    await new ResendMailerService(config() as never).sendDelivery(delivery(locale) as never);
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(sent.html).toContain(`lang="${locale}"`);
    expect(sent.subject).toBe(locale === "en" ? "Your TOTEM ANCESTRAL box is ready" : "Votre coffret TOTEM ANCESTRAL est prêt");
    expect(sent.html).toContain(locale === "en" ? "Download" : "Télécharger");
    expect(sent.html).toContain("Name &lt;unsafe&gt;");
    expect(sent.html).not.toContain("Name <unsafe>");
    expect(sent.html).toContain("30");
  });
  it("does not load the French stored template for an English delivery", async () => {
    mocks.template.mockClear().mockImplementation(async locale => ({ data: locale === "fr" ? { subject: "Ancien modèle français", html_content: "Français" } : null, error: null }));
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", fetchMock);
    await new ResendMailerService(config() as never).sendDelivery(delivery("en") as never);
    expect(mocks.template).toHaveBeenCalledExactlyOnceWith("en");
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).subject).toBe("Your TOTEM ANCESTRAL box is ready");
  });
  it("uses and safely interpolates an available localized template", async () => {
    mocks.template.mockResolvedValue({ data: { subject: "Ready {{orderId}}", html_content: '<div lang="en">{{ancestralName}} <a href="{{pdfUrl}}">PDF</a></div>' }, error: null });
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", fetchMock);
    await new ResendMailerService(config() as never).sendDelivery(delivery("en") as never);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ subject: "Ready test-order", html: expect.stringContaining("Name &lt;unsafe&gt;") });
  });
  it("keeps Junior scoring and identity codes stable while translating its delivery content", () => {
    const answers = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [String(i + 1), { choice: "A" }]));
    const fr = computeReveal(answers, undefined, "fr"), en = computeReveal(answers, undefined, "en");
    expect(en.totemId).toBe(fr.totemId); expect(en.orderNumber).toBe(fr.orderNumber);
    expect(en.dominant).toBe(fr.dominant); expect(en.secondary).toBe(fr.secondary);
    expect(en.name).not.toBe(fr.name); expect(en.phrase).toContain("Before you, an ancestor");
    expect(en.share.caption).toContain("Which ancestor sleeps within you?");
  });
  it("sends the English Junior email with English generated content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", fetchMock);
    const answers = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [String(i + 1), { choice: "A" }]));
    const reveal = computeReveal(answers, undefined, "en");
    await new ResendMailerService(config() as never).sendJuniorDelivery({ email: "test@example.invalid", firstName: "Test", totemName: reveal.name, quality: reveal.quality, phrase: reveal.phrase, locale: "en" });
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(sent.html).toContain('lang="en"'); expect(sent.html).toContain("Before you, an ancestor");
    expect(sent.html).toContain("/en/espace"); expect(sent.html).not.toContain("Avant toi");
  });
});

describe("PDF and narration language", () => {
  it.each(["fr", "en"])("generates the %s parchment and certificate with matching language and labels", async locale => {
    const texts: string[] = [];
    const draw = PDFPage.prototype.drawText;
    vi.spyOn(PDFPage.prototype, "drawText").mockImplementation(function (this: PDFPage, text, options) { texts.push(text); return draw.call(this, text, options); });
    const ai = new TotemAiService(config() as never);
    const payload = { orderId: "TEST", userId: "test", customerName: "Reader", locale, offer: "ancestral" as const, answers: [], text: {
      archetypeId: "lion", ancestralName: "Ancestral Name", parchmentText: "A story for this reader.", audioMessage: "A voice for this reader.", imagePrompt: "A mask", storyPages: [],
    } };
    for (const artefact of [await ai.generatePdf(payload), await ai.generateCertificate(payload)]) {
      const pdf = await PDFDocument.load(artefact.bytes);
      expect(pdf.catalog.lookup(PDFName.of("Lang"), PDFString).decodeText()).toBe(locale);
      expect(pdf.getPageCount()).toBeGreaterThan(0);
    }
    expect(texts.join("\n")).toContain(locale === "en" ? "Prepared for Reader" : "Prepare pour Reader");
    expect(texts.join("\n")).toContain(locale === "en" ? "Order: TEST" : "Commande: TEST");
    if (locale === "en") expect(texts.join("\n")).not.toContain("Commande:");
  }, 20_000);
  it.each(["fr", "en"])("passes %s pronunciation instructions to the fallback narrator", async locale => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2]))); vi.stubGlobal("fetch", fetchMock);
    await new TotemAiService(config() as never).generateAudio({ orderId: "test", archetypeId: "lion", text: "Test narration", locale });
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(sent.input).toBe("Test narration");
    expect(sent.instructions).toContain(locale === "en" ? "English pronunciation" : "prononciation française");
  });
  it("passes English to the primary narrator instead of forcing French", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2]))); vi.stubGlobal("fetch", fetchMock);
    await new TotemAiService(config({ IMOLE_API_KEY: "test", ELEVENLABS_VOICE_ID: "test-voice" }) as never).generateAudio({ orderId: "test", archetypeId: "lion", text: "Test narration", locale: "en" });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).language_code).toBe("en");
  });
});
