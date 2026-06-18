import { Body, Controller, Headers, Post } from "@nestjs/common";
import { SupabaseAuthService } from "./supabase-auth.service";
import { TotemOrdersService } from "./totem-orders.service";

@Controller("orders")
export class TotemOrdersController {
  constructor(
    private readonly orders: TotemOrdersService,
    private readonly auth: SupabaseAuthService,
  ) {}

  @Post("complete")
  async complete(@Body() body: unknown, @Headers("authorization") authorization?: string) {
    const user = await this.auth.requireUser(authorization);
    return this.orders.completeAfterPayment({ body, userId: user.id });
  }
}
