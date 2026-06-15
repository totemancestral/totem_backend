import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient, User } from '@supabase/supabase-js';

@Injectable()
export class SupabaseAuthService {
  private readonly supabase: SupabaseClient;

  constructor(config: ConfigService) {
    this.supabase = createClient(
      config.getOrThrow<string>('SUPABASE_URL'),
      config.getOrThrow<string>('SUPABASE_ANON_KEY'),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
  }

  async requireUser(authorization?: string): Promise<User> {
    const token = readBearerToken(authorization);
    const { data, error } = await this.supabase.auth.getUser(token);

    if (error || !data.user) {
      throw new UnauthorizedException('supabase_token_invalid');
    }

    return data.user;
  }
}

function readBearerToken(authorization?: string): string {
  const [scheme, token] = authorization?.split(' ') ?? [];

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new UnauthorizedException('bearer_token_missing');
  }

  return token;
}
