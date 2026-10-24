import { Body, Controller, Get, Headers, Header, Param, Post } from "@nestjs/common";
import { TotemAssetLinksService } from "./totem-asset-links.service";
import { SupabaseAuthService } from "./supabase-auth.service";
import { TotemOrdersService } from "./totem-orders.service";

@Controller("orders")
export class TotemOrdersController {
  constructor(
    private readonly orders: TotemOrdersService,
    private readonly auth: SupabaseAuthService,
    private readonly assetLinks: TotemAssetLinksService,
  ) {}

  @Post("asset-links")
  @Header("Cache-Control", "private, no-store")
  async renewAssets(@Body() body: unknown, @Headers("authorization") authorization?: string) {
    const user = await this.auth.requireUser(authorization);
    return this.assetLinks.forUser(user.id, body);
  }

  @Get("session/:checkoutSessionId")
  @Header("Cache-Control", "private, no-store")
  async bySession(
    @Param("checkoutSessionId") checkoutSessionId: string,
    @Headers("authorization") authorization?: string,
  ) {
    const user = await this.auth.requireUser(authorization);
    const result = await this.orders.getByCheckoutSession({
      checkoutSessionId,
      userId: user.id,
    });
    if (result.offer === "junior" && result.status === "done") {
      const [links] = await this.assetLinks.forUser(user.id, { sessionIds: [checkoutSessionId] });
      const imageUrl = links?.image_url ?? null;
      const payload = result.juniorPayload;
      return { ...result, imageUrl, juniorPayload: payload && typeof payload === "object" && !Array.isArray(payload)
        ? { ...payload, imageUrl } : payload };
    }
    return result;
  }

  @Post("complete")
  async complete(@Body() body: unknown, @Headers("authorization") authorization?: string) {
    const user = await this.auth.requireUser(authorization);
    return this.orders.completeAfterPayment({ body, userId: user.id });
  }

  @Post("retry")
  async retry(@Body() body: unknown, @Headers("authorization") authorization?: string) {
    await this.auth.requireAdmin(authorization);
    return this.orders.retry(body);
  }
}
