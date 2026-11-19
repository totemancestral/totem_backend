export const escapeEmail = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

const ink = "#282824", muted = "#65635c", gold = "#84662e", line = "#e8e4da";
export function emailFrame(title: string, inner: string, locale: "fr" | "en", eyebrow?: string): string {
  const en = locale === "en";
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light"><title>${escapeEmail(title.replaceAll("\n", " "))}</title><style>@media only screen and (max-width:480px){.mail-padding{padding:28px 24px!important}.mail-title{font-size:34px!important}.file-detail{font-size:11px!important}.mail-link{font-size:11px!important}}</style></head>
<body style="margin:0;padding:0;background:#eeede8;color:${ink};font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eeede8;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fffefa;border:1px solid #dfddd5;border-radius:3px"><tr><td class="mail-padding" style="padding:40px 46px 34px">
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td width="45" style="padding-right:13px"><img src="https://www.totem-ancestral.com/images/totem-mask-or-1024.png" width="32" height="40" alt="" style="display:block;object-fit:contain;border:0"></td><td><div style="font-size:11px;letter-spacing:3px;font-weight:600;color:${ink}">TOTEM ANCESTRAL</div><div style="margin-top:7px;font-size:9px;letter-spacing:1.7px;color:#8a7c62">${en ? "A PERSONAL CREATION" : "UNE CRÉATION PERSONNELLE"}</div></td></tr></table>
<div style="height:1px;background:${line};margin:28px 0"></div>
${eyebrow ? `<p style="margin:0 0 17px;color:${gold};font-size:10px;letter-spacing:1.6px;text-transform:uppercase;font-weight:600">${escapeEmail(eyebrow)}</p>` : ""}
<h1 class="mail-title" style="font-family:Georgia,'Times New Roman',serif;font-size:42px;line-height:1.12;letter-spacing:-1px;font-weight:400;margin:0 0 24px;color:${ink}">${escapeEmail(title).replaceAll("\n", "<br>")}</h1>
<div style="color:${muted};font-size:14px;line-height:1.8">${inner}</div>
</td></tr></table>
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%"><tr><td align="center" style="padding:20px 12px;color:#76736a;font-size:10px;line-height:1.9"><a href="https://www.totem-ancestral.com" style="color:#6e6a5e;text-decoration:none">totem-ancestral.com</a>&nbsp; · &nbsp;<a href="mailto:contact@totemancestral.com" style="color:#6e6a5e;text-decoration:none">${en ? "Need help?" : "Besoin d’aide ?"}</a><br>TOTEM ANCESTRAL</td></tr></table>
</td></tr></table></body></html>`;
}

export function emailButton(url: string, label: string) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:28px"><tr><td align="center" bgcolor="#292d29" style="border-radius:3px"><a href="${escapeEmail(url)}" style="display:block;padding:17px 14px;color:#fffefa;font-size:12px;font-weight:500;text-align:center;text-decoration:none">${escapeEmail(label)}</a></td></tr></table>`;
}

export function emailIdentity(label: string, name: string, extra = "") {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:26px 0;background:#f5f2e9;border-left:2px solid #b59a64"><tr><td style="padding:20px 22px"><p style="margin:0 0 8px;font-size:9px;letter-spacing:1.4px;text-transform:uppercase;color:#8b7958">${escapeEmail(label)}</p><p style="margin:0;color:#3a352b;font-family:Georgia,'Times New Roman',serif;font-size:23px;line-height:1.4;overflow-wrap:anywhere">${escapeEmail(name)}</p>${extra}</td></tr></table>`;
}

export type EmailFile = { url: string; label: string; description: string; format: "PDF" | "MP3" };
export function emailFiles(files: EmailFile[], locale: "fr" | "en") {
  return `<p style="margin:0 0 4px;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#79776e;font-weight:600">${locale === "en" ? "Your deliverables" : "Vos livrables"}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${files.map(file => {
    const url = new URL(file.url); url.searchParams.set("download", "1");
    return `<tr><td style="padding:18px 12px 18px 0;border-bottom:1px solid ${line};color:${ink}"><p style="margin:0 0 5px;font-size:14px;font-weight:500">${escapeEmail(file.label)}</p><p class="file-detail" style="margin:0;font-size:11px;line-height:1.6;color:#77746c">${escapeEmail(file.description)}</p></td><td align="right" valign="middle" style="border-bottom:1px solid ${line};width:105px"><a class="mail-link" href="${escapeEmail(url.toString())}" style="font-size:12px;color:${gold};text-decoration:none;white-space:nowrap" aria-label="${escapeEmail(`${locale === "en" ? "Download" : "Télécharger"} ${file.label}`)}">${file.format}&nbsp; ↓</a></td></tr>`;
  }).join("")}</table>`;
}

export function emailOrder(reference: string, detail = "") {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${line};margin-top:28px"><tr><td style="padding-top:18px;color:#77746c;font-size:10px;overflow-wrap:anywhere">${escapeEmail(reference)}</td><td align="right" style="padding:18px 0 0 12px;color:#65635c;font-size:10px;white-space:nowrap">${escapeEmail(detail)}</td></tr></table>`;
}
