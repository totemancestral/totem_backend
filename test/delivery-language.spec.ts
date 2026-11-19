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
    await new ResendMailerService(config() as never).sendDelivery({ ...delivery(locale), audioUrl: "https://example.invalid/audio" } as never);
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(sent.html).toContain(`lang="${locale}"`);
    expect(sent.subject).toBe(locale === "en" ? "Your TOTEM ANCESTRAL box is ready" : "Votre coffret TOTEM ANCESTRAL est prêt");
    expect(sent.html).toContain(locale === "en" ? "Download" : "Télécharger");
    expect(sent.html).toContain("Name &lt;unsafe&gt;");
    expect(sent.html).not.toContain("Name <unsafe>");
    expect(sent.html).toContain("30");
    expect(sent.html).toContain(locale === "en" ? "Ancestral Card (PDF)" : "Carte ancestrale (PDF)");
    expect(sent.html).toContain(locale === "en" ? "The Ancestor’s Voice" : "La voix de l’ancêtre");
    expect(sent.html).toContain("TOTEM ANCESTRAL");
    expect(sent.html).not.toContain(delivery(locale).imageUrl);
  });
  it("does not load the French stored template for an English delivery", async () => {
    mocks.template.mockClear().mockImplementation(async locale => ({ data: locale === "fr" ? { subject: "Ancien modèle français", html_content: "Français" } : null, error: null }));
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", fetchMock);
    await new ResendMailerService(config() as never).sendDelivery(delivery("en") as never);
    expect(mocks.template).toHaveBeenCalledExactlyOnceWith("en");
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).subject).toBe("Your TOTEM ANCESTRAL box is ready");
  });
  it("keeps a localized subject while using the approved layout instead of legacy HTML", async () => {
    mocks.template.mockResolvedValue({ data: { subject: "Ready {{orderId}}", html_content: '<div lang="en">{{ancestralName}} <a href="{{pdfUrl}}">PDF</a></div>' }, error: null });
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", fetchMock);
    await new ResendMailerService(config() as never).sendDelivery(delivery("en") as never);
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body)).toMatchObject({ subject: "Ready test-order", html: expect.stringContaining("Name &lt;unsafe&gt;") });
    expect(JSON.parse(fetchMock.mock.calls[0]![1].body).html).toContain("background:#fffefa");
  });
  it.each(["fr", "en"])("harmonizes legacy %s delivery templates before interpolation", async locale => {
    const oldName = locale === "en" ? "Ancestral Parchment" : "Parchemin ancestral";
    const newName = locale === "en" ? "Ancestral Card" : "Carte ancestrale";
    mocks.template.mockResolvedValue({ data: { subject: oldName, html_content: `<a href="{{pdfUrl}}">${oldName}</a>` }, error: null });
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", fetchMock);
    await new ResendMailerService(config() as never).sendDelivery(delivery(locale) as never);
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(sent.subject).toBe(newName);
    expect(sent.html).toContain(newName);
    expect(sent.html).not.toContain(oldName);
    expect(sent.html).toContain("https://example.invalid/pdf");
  });
  it.each(["fr", "en"])("uses the approved %s file rows without rewriting user data", async locale => {
    mocks.template.mockResolvedValue({ data: {
      subject: "{{ancestralName}}",
      html_content: '<p>{{ancestralName}}</p><a href="{{imageUrl}}">Image</a><a href="{{audioUrl}}">Audio</a><a href="{{pdfUrl}}">PDF</a>',
    }, error: null });
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", fetchMock);
    const payload = { ...delivery(locale), audioUrl: "https://example.invalid/audio" };
    payload.order.ancestralName = "Parchemin ancestral";
    await new ResendMailerService(config() as never).sendDelivery(payload as never);
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(sent.subject).toBe("Parchemin ancestral");
    expect(sent.html).not.toContain(payload.imageUrl);
    expect(sent.html).toContain(locale === "en" ? ">The Ancestor’s Voice<" : ">La voix de l’ancêtre<");
    expect(sent.html).toContain(locale === "en" ? ">Ancestral Card (PDF)<" : ">Carte ancestrale (PDF)<");
    expect(sent.html).toContain(payload.pdfUrl);
  });
  it("never advertises narration for Origine, even with a stale audio URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", fetchMock);
    await new ResendMailerService(config() as never).sendDelivery({ ...delivery("fr"), order: { ...delivery("fr").order, offer: "origine", amountCents: 2900 }, audioUrl: "https://example.invalid/stale-audio" } as never);
    const html = JSON.parse(fetchMock.mock.calls[0]![1].body).html;
    expect(html).toContain("Origine"); expect(html).not.toContain("stale-audio"); expect(html).not.toContain("MP3");
  });
  it.each(["fr", "en"])("preserves the private parental link and expiry in the light %s email", async locale => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}")); vi.stubGlobal("fetch", fetchMock);
    await new ResendMailerService(config() as never).sendParentConfirmation({ email: "parent@example.invalid", firstName: "Test <unsafe>", locale, link: `https://example.invalid/${locale}/autorisation-parentale#token=private-token` });
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(sent.to).toEqual(["parent@example.invalid"]);
    expect(sent.html).toContain("#token=private-token"); expect(sent.html).toContain("24");
    expect(sent.html).toContain("Test &lt;unsafe&gt;"); expect(sent.html).toContain("background:#fffefa");
    expect(sent.html).not.toContain("Test <unsafe>"); expect(sent.html).not.toContain("MP3");
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
    await new ResendMailerService(config() as never).sendJuniorDelivery({ email: "test@example.invalid", firstName: "Test", totemName: reveal.name, quality: reveal.quality, phrase: reveal.phrase, locale: "en",
      orderId: "test-order", pdfUrl: "https://example.invalid/card.pdf", certificateUrl: "https://example.invalid/certificate.pdf",
      attachments: [{ filename: "card.pdf", content: "JVBERg==" }, { filename: "certificate.pdf", content: "JVBERg==" }],
    });
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(sent.html).toContain('lang="en"'); expect(sent.html).toContain("Before you, an ancestor");
    expect(sent.html).toContain("without signing in"); expect(sent.html).not.toContain("Avant toi");
    expect(sent.attachments).toHaveLength(2);
    expect(sent.attachments.map((a: { filename: string }) => a.filename)).toEqual(["card.pdf", "certificate.pdf"]);
    expect(sent.html).not.toContain("image.jpg");
    expect(fetchMock.mock.calls[0]![1].headers["Idempotency-Key"]).toBe("junior-delivery-test-order");
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
    expect(texts.join("\n")).toContain(locale === "en" ? "Prepared for Reader" : "Préparé pour Reader");
    expect(texts.join("\n")).toContain(locale === "en" ? "ANCESTRAL CARD" : "CARTE ANCESTRALE");
    expect(texts.join("\n")).toContain(locale === "en" ? "ANCESTRAL STORY" : "HISTOIRE ANCESTRALE");
    if (locale === "fr") {
      expect(texts.join("\n")).toContain("Décret royal de révélation symbolique");
      expect(texts.join("\n")).toContain("RÉVÉLATION");
      expect(texts.join("\n")).not.toContain("Prepare pour");
      expect(texts.join("\n")).not.toContain("Decret royal");
    }
    expect(texts.join("\n")).toContain(locale === "en" ? "Order: TEST" : "Commande: TEST");
    if (locale === "en") expect(texts.join("\n")).not.toContain("Commande:");
  }, 20_000);
  it.each(["fr", "en"])("uses the question narrator and original stability for %s", async locale => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2])));
    vi.stubGlobal("fetch", fetchMock);
    await new TotemAiService(config({ ELEVENLABS_API_KEY: "test" }) as never).generateAudio({ orderId: "test", archetypeId: "lion", text: "Test narration", locale });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toBe("https://api.elevenlabs.io/v1/text-to-speech/RmoPMgQUNbqVyHmDrfhA?output_format=mp3_44100_128");
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(sent).toEqual({ text: "Test narration", model_id: "eleven_v3", language_code: locale, voice_settings: { stability: 0.5 } });
  });
  it("propagates ElevenLabs failure without switching narrator or provider", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new TotemAiService(config({ ELEVENLABS_API_KEY: "test", IMOLE_API_KEY: "test" }) as never).generateAudio({ orderId: "test", archetypeId: "lion", text: "Test" })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]![0]).toContain("api.elevenlabs.io");
  });
  it("refuses missing credentials instead of producing a different voice", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(new TotemAiService(config() as never).generateAudio({ orderId: "test", archetypeId: "lion", text: "Test" })).rejects.toThrow("elevenlabs_api_key_missing");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("splits long stories within the model limit and retains the same voice", async () => {
    const fetchMock = vi.fn().mockImplementation(async () => new Response(new Uint8Array([1, 2])));
    vi.stubGlobal("fetch", fetchMock);
    const result = await new TotemAiService(config({ ELEVENLABS_API_KEY: "test" }) as never).generateAudio({ orderId: "test", archetypeId: "lion", text: "A long ancestral story. ".repeat(400), locale: "en" });
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
    for (const [url, options] of fetchMock.mock.calls) {
      expect(url).toContain("RmoPMgQUNbqVyHmDrfhA");
      expect(JSON.parse(options.body).text.length).toBeLessThanOrEqual(3600);
    }
    expect(result.bytes.length).toBe(fetchMock.mock.calls.length * 2);
  });
});
