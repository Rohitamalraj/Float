import { NextResponse } from 'next/server';
import { Forbidden, Unauthorized } from './auth';

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data as Record<string, unknown>, init);
}

export function fail(status: number, message: string) {
  return NextResponse.json({ error: message }, { status });
}

/** Wrap a route handler so thrown auth/validation errors become clean JSON. */
export function handler<Args extends unknown[]>(
  fn: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof Unauthorized) return fail(401, err.message);
      if (err instanceof Forbidden) return fail(403, err.message);
      if (err instanceof ApiError) return fail(err.status, err.message);
      console.error('[api] unhandled', err);
      return fail(500, 'internal error');
    }
  };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function bad(message: string): never {
  throw new ApiError(400, message);
}
export function notFound(message = 'not found'): never {
  throw new ApiError(404, message);
}
