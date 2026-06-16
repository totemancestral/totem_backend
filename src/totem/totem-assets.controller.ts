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

    if (object.contentType === "application/pdf") {
      response.setHeader("Content-Disposition", 'attachment; filename="totem-parchemin.pdf"');
    }

    if (object.contentLength) {
      response.setHeader("Content-Length", object.contentLength.toString());
    }

    object.body.pipe(response);
  }
}
