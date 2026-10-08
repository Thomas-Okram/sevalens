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

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  console.error('[api] unhandled error', err);
  // never leak stack traces to the client
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
}
