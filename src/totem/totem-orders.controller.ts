import { Body, Controller, Get, Headers, Param, Post } from "@nestjs/common";
import { SupabaseAuthService } from "./supabase-auth.service";
import { TotemOrdersService } from "./totem-orders.service";

@Controller("orders")
export class TotemOrdersController {
  constructor(
    private readonly orders: TotemOrdersService,
    private readonly auth: SupabaseAuthService,
  ) {}

  @Get("session/:checkoutSessionId")
  async bySession(
    @Param("checkoutSessionId") checkoutSessionId: string,
    @Headers("authorization") authorization?: string,
  ) {
    const user = await this.auth.requireUser(authorization);
    return this.orders.getByCheckoutSession({
      checkoutSessionId,
      userId: user.id,
    });
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
