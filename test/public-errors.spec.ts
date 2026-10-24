import { afterEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException, HttpException, Logger } from '@nestjs/common';
import { z } from 'zod';
import { publicError, PublicErrorFilter } from '../src/public-error.filter';

afterEach(() => vi.restoreAllMocks());
describe('public HTTP error boundary', () => {
  it('hides unexpected exception content', () => {
    const result = publicError(new Error('postgres password=private token secret query'));
    expect(result).toEqual({ status: 500, code: 'service_unavailable', retryAfter: undefined });
    expect(JSON.stringify(result)).not.toContain('private');
  });
  it('keeps a reviewed code but removes nested validation details', () => {
    const error = new BadRequestException({ code: 'checkout_payload_invalid', detail: 'private-input', message: 'private error', stack: 'private stack' });
    expect(publicError(error)).toMatchObject({ status: 400, code: 'checkout_payload_invalid' });
    expect(JSON.stringify(publicError(error))).not.toContain('private');
  });
  it('does not trust arbitrary HTTP exception messages or codes', () => {
    expect(publicError(new HttpException({ code: 'database_secret', message: 'private' }, 403))).toMatchObject({ status: 403, code: 'access_denied' });
    expect(publicError(new HttpException('auth_failed: private', 401))).toMatchObject({ status: 401, code: 'authentication_required' });
  });
  it('treats uncaught schema errors as invalid requests without reflecting the input', () => {
    const result = z.object({ id: z.string() }).safeParse({ id: { private: 'secret' } });
    expect(result.success).toBe(false);
    if (!result.success) expect(publicError(result.error)).toMatchObject({ status: 400, code: 'request_invalid' });
  });
  it.each([429, 503])('preserves status %s and a valid retry delay', status => {
    expect(publicError(new HttpException({ message: 'rate_limit_exceeded', retryAfter: 37 }, status))).toMatchObject({ status, code: 'rate_limit_exceeded', retryAfter: 37 });
  });
  it.each([-1, 0, Infinity, '37', 9999999])('drops an invalid retry delay %s', retryAfter => {
    expect(publicError(new HttpException({ message: 'rate_limit_exceeded', retryAfter }, 429)).retryAfter).toBeUndefined();
  });
  it('returns a trace ID shared with server diagnostics without exposing private content', () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const headers: Record<string, string> = {};
    const response = { headersSent: false, setHeader: vi.fn((k, v) => { headers[k] = v; }), status: vi.fn().mockReturnThis(), json: vi.fn() };
    const host = { switchToHttp: () => ({ getResponse: () => response }) };
    new PublicErrorFilter().catch(new BadRequestException({ code: 'checkout_payload_invalid', detail: 'private-input' }), host as never);
    const jsonCall = response.json.mock.calls[0];
    if (!jsonCall) throw new Error('Expected an HTTP error response');
    const body = jsonCall[0];
    expect(body).toMatchObject({ statusCode: 400, code: 'checkout_payload_invalid', message: 'checkout_payload_invalid', requestId: headers['X-Request-Id'] });
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(log.mock.calls[0]?.[0]).toMatchObject({ requestId: body.requestId, code: body.code });
    expect(JSON.stringify(body)).not.toContain('private-input');
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-input');
  });
  it('does not copy multiline exception messages into diagnostic stack frames', () => {
    const log = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
    const error = new Error('private-input');
    error.stack = 'Error: private-input\nprivate-input on second line\n    at handler (/srv/handler.ts:12:3)';
    const response = { headersSent: false, setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn() };
    new PublicErrorFilter().catch(error, { switchToHttp: () => ({ getResponse: () => response }) } as never);
    expect(JSON.stringify(log.mock.calls)).not.toContain('private-input');
    expect(log.mock.calls[0]?.[0]).toMatchObject({ frames: ['    at handler (/srv/handler.ts:12:3)'] });
  });
});
