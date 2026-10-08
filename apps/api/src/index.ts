import 'dotenv/config';
import { createApp } from './app';
import { getSnapshot } from './services/snapshot';
import { aiEnabled, aiModel } from './ai/llm';

const port = Number(process.env.PORT ?? 4000);
try {
  getSnapshot(); // warm the analytics cache so the first page load is instant
} catch (e) {
  console.error('[api] could not build analytics snapshot — did you run `npm run setup`?', e);
}
createApp().listen(port, () => {
  console.log(`[api] SevaLens API on http://localhost:${port}`);
  console.log(`[api] AI: ${aiEnabled() ? `enabled (${aiModel()})` : 'no ANTHROPIC_API_KEY — deterministic fallbacks active'}`);
});
