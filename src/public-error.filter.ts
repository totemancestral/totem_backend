import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import { ZodError } from 'zod';

// Only explicitly reviewed application codes can cross the HTTP boundary.
const PUBLIC_CODES = new Set([
  'auth_failed', 'authentication_unavailable', 'supabase_token_invalid', 'bearer_token_missing',
  'admin_access_required', 'admin_role_check_failed', 'mfa_required',
  'oeuvre_required', 'serie_indisponible', 'invalid_cursor', 'tirage_payload_invalid',
  'rate_limit_exceeded', 'rate_limit_unavailable', 'service_unavailable',
  'payment_not_confirmed', 'payment_verification_unavailable',
  'junior_payload_invalid', 'junior_payment_not_confirmed', 'junior_order_answers_invalid',
  'junior_answers_mismatch', 'junior_totem_not_found', 'offer_price_invalid',
  'external_command_invalid', 'commande_not_found', 'order_not_found', 'order_user_mismatch',
  'stripe_session_missing', 'checkout_session_mismatch', 'payment_intent_mismatch',
  'paid_complete_adult_order_required', 'adult_answers_incomplete', 'adult_order_required',
  'complete_order_payload_invalid', 'checkout_payload_invalid', 'asset_links_payload_invalid',
  'totem_already_exists', 'totem_order_in_progress', 'totem_checkout_in_progress',
  'stripe_signature_missing', 'stripe_signature_invalid', 'stripe_event_invalid',
  'stripe_metadata_invalid', 'artefact_not_found', 'signed_url_invalid', 'signed_url_expired',
  'checkout_session_invalid', 'payment_intent_invalid', 'checkout_metadata_invalid',
]);

export function publicError(exception: unknown) {
  const status = exception instanceof HttpException ? exception.getStatus() : exception instanceof ZodError ? 400 : 500;
  const body = exception instanceof HttpException ? exception.getResponse() : null;
  const object = body && typeof body === 'object' ? body as Record<string, unknown> : null;
  const candidate = typeof object?.code === 'string' ? object.code : typeof object?.message === 'string' ? object.message : typeof body === 'string' ? body : '';
  const fallback = status >= 500 ? 'service_unavailable' : status === 401 ? 'authentication_required'
    : status === 403 ? 'access_denied' : status === 404 ? 'resource_not_found'
      : status === 429 ? 'rate_limit_exceeded' : 'request_invalid';
  const code = PUBLIC_CODES.has(candidate) ? candidate : fallback;
  const delay = object?.retryAfter;
  const retryAfter = [429, 503].includes(status) && typeof delay === 'number' && Number.isInteger(delay) && delay > 0 && delay <= 604800 ? delay : undefined;
  return { status, code, retryAfter };
}

@Catch()
export class PublicErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(PublicErrorFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const { status, code, retryAfter } = publicError(exception);
    const requestId = randomUUID();
    // No request body, credentials, headers or arbitrary exception payload.
    // Stack frames retain the source location without copying the message or input values.
    this.logger.error({ requestId, status, code,
      errorType: exception instanceof Error ? exception.name : 'UnknownError',
      frames: exception instanceof Error ? exception.stack?.split('\n').filter(frame => /^\s+at\s/.test(frame)).slice(0, 5).map(frame => frame.replace(/https?:\/\/\S+/g, '[remote location]')) : undefined,
    });
    if (response.headersSent) return;
    response.setHeader('X-Request-Id', requestId);
    response.setHeader('Cache-Control', 'private, no-store');
    if (retryAfter !== undefined) response.setHeader('Retry-After', String(retryAfter));
    response.status(status).json({ statusCode: status, code, message: code, requestId,
      ...(retryAfter === undefined ? {} : { retryAfter }) });
  }
}
