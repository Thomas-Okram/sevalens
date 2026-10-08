import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  password: z.string().min(1).max(200),
});

export const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

export const pendencyQuerySchema = z.object({
  districtId: z.coerce.number().int().positive().optional(),
  blockId: z.coerce.number().int().positive().optional(),
  schemeId: z.coerce.number().int().positive().optional(),
  stage: z.enum(['document_check', 'field_verification', 'sanction', 'payment_setup']).optional(),
  breachedOnly: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const anomaliesQuerySchema = z.object({
  districtId: z.coerce.number().int().positive().optional(),
  type: z.string().max(40).optional(),
  includeDismissed: z.enum(['true', 'false']).optional().transform((v) => v === 'true'),
});

export const reviewSchema = z.object({
  status: z.enum(['open', 'reviewed', 'false_positive']),
  note: z.string().trim().max(500).optional(),
});

export const askSchema = z.object({
  question: z.string().trim().min(3).max(300),
});

export const briefSchema = z.object({
  refresh: z.boolean().optional(),
});

/** Whitelisted query intents for "Ask SevaLens". The LLM can only pick from these. */
export const askIntentSchema = z.discriminatedUnion('intent', [
  z.object({
    intent: z.literal('pending_by_block'),
    district: z.string().max(40).nullable().optional(),
    scheme: z.string().max(40).nullable().optional(),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  z.object({
    intent: z.literal('coverage_gap'),
    district: z.string().max(40).nullable().optional(),
    scheme: z.string().max(40).nullable().optional(),
    level: z.enum(['district', 'block']).optional(),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  z.object({
    intent: z.literal('attention_ranking'),
    level: z.enum(['district', 'block']).optional(),
    district: z.string().max(40).nullable().optional(),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  z.object({
    intent: z.literal('anomalies_list'),
    district: z.string().max(40).nullable().optional(),
    type: z.string().max(40).nullable().optional(),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  z.object({
    intent: z.literal('disbursement_failures'),
    district: z.string().max(40).nullable().optional(),
    limit: z.number().int().min(1).max(20).optional(),
  }),
  z.object({
    intent: z.literal('sla_breach_by_scheme'),
    district: z.string().max(40).nullable().optional(),
  }),
]);
export type AskIntentParams = z.infer<typeof askIntentSchema>;
