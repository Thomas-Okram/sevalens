export const aiModel = () => process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5';
export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);
