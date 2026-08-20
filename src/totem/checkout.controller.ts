import { Body, Controller, Headers, Post } from '@nestjs/common';
import { CheckoutService } from './checkout.service';
import { SupabaseAuthService } from './supabase-auth.service';

@Controller('checkout')
export class CheckoutController {
  constructor(
    private readonly checkout: CheckoutService,
    private readonly auth: SupabaseAuthService,
  ) {}

  @Post()
  async create(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
  ): Promise<{ id: string; url: string | null }> {
    const user = await this.auth.requireUser(authorization);

    return this.checkout.createSession({
      body,
      userId: user.id,
      email: user.email,
    });
  }
}
