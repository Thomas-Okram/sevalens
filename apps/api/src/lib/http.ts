import type { NextFunction, Request, Response } from 'express';
import type { ZodSchema, z } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function parse<S extends ZodSchema>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, 'Invalid input: ' + r.error.issues.map((i) => `${i.path.join('.') || 'value'} ${i.message}`).join('; '));
  return r.data;
}

/** Wrap async/sync handlers so thrown errors reach the error middleware. */
export const h =
  (fn: (req: Request, res: Response, next: NextFunction) => unknown) =>
  (req: Request, res: Response, next: NextFunction) => {
    try {
      const r = fn(req, res, next);
      if (r instanceof Promise) r.catch(next);
    } catch (e) {
      next(e);
    }
  };

const BODY_ERRORS: Record<string, string> = {
  'entity.parse.failed': 'Request body is not valid JSON.',
  'entity.too.large': 'Request body is too large.',
  'encoding.unsupported': 'Unsupported request encoding.',
  'charset.unsupported': 'Unsupported request charset.',
};

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  // body-parser errors carry the raw request body (e.g. a login password): reply 4xx and never log them
  const type = (err as { type?: unknown })?.type;
  const status = (err as { status?: unknown })?.status;
  if (typeof type === 'string' && typeof status === 'number' && status >= 400 && status < 500) {
    return res.status(status).json({ error: BODY_ERRORS[type] ?? 'Invalid request.' });
  }
  console.error('[api] unhandled error', err instanceof Error ? err.stack : err);
  // never leak stack traces to the client
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
}
