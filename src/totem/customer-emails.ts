import { emailFrame, emailButton, emailIdentity, emailFiles, emailOrder, escapeEmail, type EmailFile } from "./email-design";
import type { TotemOrder } from "@prisma/client";

export function renderAdultDelivery(input: { order: TotemOrder; pdfUrl: string; audioUrl: string | null; certificateUrl: string }) {
  const en = input.order.locale === "en", locale = en ? "en" : "fr";
  const files: EmailFile[] = [
    { url: input.pdfUrl, label: en ? "Ancestral Card (PDF)" : "Carte ancestrale (PDF)", description: en ? "Your totem and your ancestral story." : "Votre totem et votre histoire ancestrale.", format: "PDF" },
    ...(input.audioUrl && input.order.offer !== "origine" ? [{ url: input.audioUrl, label: en ? "The Ancestor’s Voice" : "La voix de l’ancêtre", description: en ? "Your ancestral message to listen to." : "Votre message ancestral à écouter.", format: "MP3" as const }] : []),
    { url: input.certificateUrl, label: en ? "Certificate of Authenticity" : "Certificat d’authenticité", description: en ? "A personal, numbered certificate." : "Un certificat personnel et numéroté.", format: "PDF" },
  ];
  const name = input.order.customerName;
  const offer = { origine: "Origine", ancestral: en ? "Revelation" : "Révélation", famille: en ? "Family" : "Famille", junior: "Junior" }[input.order.offer] ?? "";
  const amount = typeof input.order.amountCents === "number" ? new Intl.NumberFormat(en ? "en-IE" : "fr-FR", { style: "currency", currency: "EUR" }).format(input.order.amountCents / 100) : "";
  const inner = `<p style="margin:0"><span style="color:#282824">${en ? "Hello" : "Bonjour"}${name ? ` ${escapeEmail(name)}` : ""},</span><br>${en ? "Your ancestral creation is ready. Find your deliverables below." : "Votre création ancestrale est prête. Retrouvez vos livrables ci-dessous."}</p>`
    + emailIdentity(en ? "Your ancestral name" : "Votre nom ancestral", input.order.ancestralName ?? (en ? "Your totem" : "Votre totem"))
    + emailFiles(files, locale)
    + emailButton(`https://www.totem-ancestral.com/${locale}/espace`, en ? "Open my space" : "Ouvrir mon espace")
    + `<p style="margin:13px 0 0;text-align:center;font-size:11px;color:#77746c">${en ? "These personal, signed links remain valid for 30 days." : "Ces liens personnels et signés restent valides pendant 30 jours."}</p>`
    + emailOrder(`${en ? "Order" : "Commande"} ${input.order.id}`, [offer, amount].filter(Boolean).join(" · "));
  return emailFrame(en ? "Your story.\nYour totem." : "Votre histoire.\nVotre totem.", inner, locale, en ? "Your creation is available" : "Votre création est disponible");
}

export function renderJuniorDelivery(input: { firstName: string; totemName: string; quality: string; phrase: string; locale?: string; orderId: string; pdfUrl: string; certificateUrl: string }) {
  const fr = input.locale !== "en", locale = fr ? "fr" : "en";
  const inner = `<p style="margin:0">${fr
    ? `Bonjour, le parcours de ${escapeEmail(input.firstName)} a révélé son animal totem et son nom sacré. Sa carte ancestrale et son certificat d’authenticité numéroté sont joints à cet e-mail.`
    : `Hello, ${escapeEmail(input.firstName)}’s journey has revealed their totem animal and sacred name. Their Ancestral Card and numbered Certificate of Authenticity are attached to this email.`}</p>`
    + emailIdentity(fr ? "Son nom ancestral" : "Their ancestral name", input.totemName,
      `<p style="margin:10px 0 0;color:#84662e;font-size:12px">${escapeEmail(input.quality)}</p><p style="margin:8px 0 0;font-family:Georgia,serif;font-style:italic;color:#65635c">${escapeEmail(input.phrase)}</p>`)
    + emailFiles([
      { url: input.pdfUrl, label: fr ? "Carte ancestrale (PDF)" : "Ancestral Card (PDF)", description: fr ? "Son totem et sa carte ancestrale." : "Their totem and ancestral card.", format: "PDF" },
      { url: input.certificateUrl, label: fr ? "Certificat d’authenticité" : "Certificate of Authenticity", description: fr ? "Un certificat personnel et numéroté." : "A personal, numbered certificate.", format: "PDF" },
    ], locale)
    + `<p style="margin:20px 0 0;font-size:12px;color:#77746c">${fr ? "Les deux documents sont téléchargeables sans connexion au compte de l’enfant." : "Both documents can be downloaded without signing in to the child’s account."}</p>`
    + emailOrder(`${fr ? "Commande" : "Order"} ${input.orderId}`, "Junior");
  return emailFrame(fr ? "La carte ancestrale Junior est prête" : "The Junior Ancestral Card is ready", inner, locale, fr ? "La création de votre enfant" : "Your child’s creation");
}

export function renderParentalConfirmation(input: { firstName: string; locale: string; link: string }) {
  const fr = input.locale !== "en";
  const inner = `<p style="margin:0">${fr ? `Une demande de création de carte ancestrale concerne ${escapeEmail(input.firstName)}.` : `An Ancestral Card creation request concerns ${escapeEmail(input.firstName)}.`}</p>`
    + emailIdentity(fr ? "Enfant concerné" : "Child concerned", input.firstName)
    + `<p>${fr ? "Confirmez votre adresse et votre autorisation, puis réglez 9,99 €. Le lien est valable 24 heures." : "Confirm your address and permission, then pay €9.99. The link is valid for 24 hours."}</p>`
    + emailButton(input.link, fr ? "Voir la demande parentale" : "View the parental request")
    + `<p style="margin:20px 0 0;font-size:12px;color:#77746c">${fr ? "Si vous ne reconnaissez pas cette demande, vous pouvez ignorer cet e-mail." : "If you do not recognize this request, you can ignore this email."}</p>`;
  return emailFrame(fr ? "Autorisation parentale" : "Parental permission", inner, fr ? "fr" : "en", "Totem Junior");
}
