import { Body, Controller, Get, Header, Headers, Post } from "@nestjs/common";
import { ParentConsentService } from "./parent-consent.service";
import { SupabaseAuthService } from "./supabase-auth.service";

@Controller("junior/parent")
export class ParentConsentController {
  constructor(private readonly parents: ParentConsentService, private readonly auth: SupabaseAuthService) {}

  @Get("request")
  @Header("Cache-Control", "private, no-store")
  async latest(@Headers("authorization") authorization?: string) {
    return this.parents.latest((await this.auth.requireUser(authorization)).id);
  }

  @Post("request")
  async request(@Body() body: unknown, @Headers("authorization") authorization?: string) {
    return this.parents.request(body, (await this.auth.requireUser(authorization)).id);
  }

  @Post("status")
  @Header("Cache-Control", "private, no-store")
  status(@Body() body: { token?: unknown }) { return this.parents.status(body?.token); }

  @Post("confirm")
  confirm(@Body() body: { token?: unknown; requestId?: unknown }) { return this.parents.confirm(body?.token, body?.requestId); }

  @Post("checkout")
  checkout(@Body() body: { token?: unknown; requestId?: unknown }) { return this.parents.pay(body?.token, body?.requestId); }
}
