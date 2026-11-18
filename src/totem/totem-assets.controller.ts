import { Controller, Get, Param, Query, Res } from "@nestjs/common";
import { Response } from "express";
import { SupabaseStorageService } from "./supabase-storage.service";

@Controller("totem-assets")
export class TotemAssetsController {
  constructor(private readonly storage: SupabaseStorageService) {}

  @Get(":token")
  async read(
    @Param("token") token: string,
    @Query("download") download: string | undefined,
    @Query("inline") inline: string | undefined,
    @Res() response: Response,
  ): Promise<void> {
    const object = await this.storage.readSignedObject(token);
    const isImage = object.contentType.startsWith("image/");
    const isExplicitDownload = download === "1" || download === "true";
    const isExplicitInline = download === "0" || download === "false" || inline === "1";
    const disposition = isExplicitDownload ? "attachment" : (isExplicitInline || isImage ? "inline" : "attachment");

    response.setHeader("Content-Type", object.contentType);
    response.setHeader("Cache-Control", "private, max-age=3600");
    response.setHeader(
      "Content-Disposition",
      `${disposition}; filename="${downloadFilename(object.contentType, object.key)}"`,
    );

    if (object.contentLength) {
      response.setHeader("Content-Length", object.contentLength.toString());
    }

    object.body.pipe(response);
  }
}

function downloadFilename(contentType: string, key: string): string {
  if (contentType === "application/pdf") return /\/certificate-[^/]+\.pdf$/i.test(key)
    ? "TOTEM-ANCESTRAL-Certificat.pdf" : "TOTEM-ANCESTRAL-Carte-Ancestrale.pdf";
  if (contentType.startsWith("audio/")) return "TOTEM-ANCESTRAL-La-Voix-de-l-Ancetre.mp3";
  if (contentType === "image/jpeg") return "TOTEM-ANCESTRAL-Totem.jpg";
  if (contentType.startsWith("image/")) return "TOTEM-ANCESTRAL-Totem.png";
  return "TOTEM-ANCESTRAL-Fichier";
}
