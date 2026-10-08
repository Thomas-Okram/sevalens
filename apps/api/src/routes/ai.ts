import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { askSchema, briefSchema, idParamSchema } from '@sevalens/shared';
import { getSnapshot } from '../services/snapshot';
import { assertInScope, districtScope } from '../middleware/auth';
import { audit } from '../lib/audit';
import { h, parse } from '../lib/http';
import { briefFacts, cachedBrief, generateBrief } from '../ai/brief';
import { toLLMPayload } from '../ai/sanitize';
import { aiEnabled, aiModel } from '../ai/llm';
import { ask } from '../ai/ask';

export const aiRouter = Router();

aiRouter.use(rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many AI requests — please wait a minute.' } }));

aiRouter.get('/brief/:id', h((req, res) => {
  const { id } = parse(idParamSchema, req.params);
  assertInScope(req, id);
  res.json({ brief: cachedBrief(getSnapshot(), id) });
}));

aiRouter.post('/brief/:id', h(async (req, res) => {
  const { id } = parse(idParamSchema, req.params);
  const { refresh } = parse(briefSchema, req.body ?? {});
  assertInScope(req, id);
  const brief = await generateBrief(getSnapshot(), id, Boolean(refresh));
  audit(req, 'ai.brief_generated', 'district', id, { source: brief.source, model: brief.model, refresh: Boolean(refresh) });
  res.json({ brief });
}));

aiRouter.post('/ask', h(async (req, res) => {
  const { question } = parse(askSchema, req.body);
  const result = await ask(getSnapshot(), question, districtScope(req));
  audit(req, 'ai.ask', 'query', result.intent, { question, intent: result.intent, filters: result.filters, source: result.source });
  res.json(result);
}));

/** Transparency: the exact sanitised payload the brief would send to the LLM for a district. */
aiRouter.get('/payload-preview/:id', h((req, res) => {
  const { id } = parse(idParamSchema, req.params);
  assertInScope(req, id);
  res.json({ aiEnabled: aiEnabled(), model: aiEnabled() ? aiModel() : null, payload: toLLMPayload(briefFacts(getSnapshot(), id)) });
}));
