import { Controller, Get, Param, Res } from "@nestjs/common";
import { Response } from "express";
import { SupabaseStorageService } from "./supabase-storage.service";

@Controller("totem-assets")
export class TotemAssetsController {
  constructor(private readonly storage: SupabaseStorageService) {}

  @Get(":token")
  async read(@Param("token") token: string, @Res() response: Response): Promise<void> {
    const object = await this.storage.readSignedObject(token);

    response.setHeader("Content-Type", object.contentType);
    response.setHeader("Cache-Control", "private, max-age=300");
    response.setHeader(
      "Content-Disposition",
      `attachment; filename="${downloadFilename(object.contentType)}"`,
    );

    if (object.contentLength) {
      response.setHeader("Content-Length", object.contentLength.toString());
    }

    object.body.pipe(response);
  }
}

function downloadFilename(contentType: string): string {
  if (contentType === "application/pdf") return "totem-parchemin.pdf";
  if (contentType.startsWith("audio/")) return "totem-narration.mp3";
  if (contentType === "image/jpeg") return "totem-image.jpg";
  if (contentType.startsWith("image/")) return "totem-image.png";
  return "totem-asset";
}
