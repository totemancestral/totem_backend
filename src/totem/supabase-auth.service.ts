import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

interface SupabaseUser {
  id: string;
  email?: string;
}

async function fetchUser(url: string, anonKey: string, token: string): Promise<SupabaseUser> {
  const res = await fetch(`${url}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) {
    throw new UnauthorizedException('supabase_token_invalid');
  }

  const body = await res.json();
  if (!body?.id) {
    throw new UnauthorizedException('supabase_token_invalid');
  }

  return { id: body.id as string, email: body.email as string | undefined };
}

function readBearerToken(authorization?: string): string {
  const [scheme, token] = authorization?.split(' ') ?? [];

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    throw new UnauthorizedException('bearer_token_missing');
  }

  return token;
}

@Injectable()
export class SupabaseAuthService {
  private readonly supabaseUrl: string;
  private readonly supabaseAnonKey: string;
  private readonly serviceSupabase: SupabaseClient;

  constructor(config: ConfigService) {
    this.supabaseUrl = config.getOrThrow<string>('SUPABASE_URL');
    this.supabaseAnonKey = config.getOrThrow<string>('SUPABASE_ANON_KEY');
    this.serviceSupabase = createClient(
      config.getOrThrow<string>('SUPABASE_URL'),
      config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    );
  }

  async requireUser(authorization?: string): Promise<SupabaseUser> {
    const token = readBearerToken(authorization);
    try {
      return await fetchUser(this.supabaseUrl, this.supabaseAnonKey, token);
    } catch (e) {
      const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      const stack = e instanceof Error ? e.stack || '' : '';
      console.error(`[SupabaseAuthService] requireUser error: ${msg}\n${stack}`);
      throw new UnauthorizedException(`auth_failed:${msg.slice(0, 120)}`);
    }
  }

  async requireAdmin(authorization?: string): Promise<SupabaseUser> {
    const user = await this.requireUser(authorization);

    const { data: role, error } = await this.serviceSupabase
      .from('user_roles')
      .select('id')
      .eq('user_id', user.id)
      .eq('role', 'admin')
      .maybeSingle();

    if (error) {
      throw new ForbiddenException('admin_role_check_failed');
    }

    if (!role) {
      throw new ForbiddenException('admin_access_required');
    }

    return user;
  }
}
