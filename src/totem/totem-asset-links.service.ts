import { BadRequestException, Injectable } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../prisma/prisma.service";
import { SupabaseStorageService } from "./supabase-storage.service";

const inputSchema = z.object({ sessionIds: z.array(z.string().min(1).max(255)).min(1).max(100) }).strict();

@Injectable()
export class TotemAssetLinksService {
  constructor(private readonly prisma: PrismaService, private readonly storage: SupabaseStorageService) {}

  async forUser(userId: string, body: unknown) {
    const parsed = inputSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("asset_links_payload_invalid");
    // Filtrer le propriétaire dans la requête, avant toute signature de fichier.
    const orders = await this.prisma.totemOrder.findMany({
      where: { userId, status: "done", checkoutSessionId: { in: [...new Set(parsed.data.sessionIds)] } },
      select: {
        id: true, checkoutSessionId: true, imageKey: true, imageUrl: true,
        audioKey: true, audioUrl: true, pdfKey: true, pdfUrl: true,
        certificateKey: true, certificateUrl: true,
        parchmentKey: true, parchmentUrl: true,
      },
    });
    return orders.map((order) => ({
      sessionId: order.checkoutSessionId,
      image_url: this.storage.renewOwnedUrl(order.id, order.imageKey, order.imageUrl),
      audio_url: this.storage.renewOwnedUrl(order.id, order.audioKey, order.audioUrl),
      pdf_url: this.storage.renewOwnedUrl(order.id, order.pdfKey ?? order.parchmentKey, order.pdfUrl ?? order.parchmentUrl),
      certificate_url: this.storage.renewOwnedUrl(order.id, order.certificateKey, order.certificateUrl),
    }));
  }
}
