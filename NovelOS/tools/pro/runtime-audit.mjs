import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const aliases = {
  'feelfish/claude-opus-5-5': ['claude-opus-5-5', 'anthropic/claude-opus-5.5'],
  'anthropic/claude-sonnet-5.5': ['claude-sonnet-5-5'],
  'feelfish/gemini-3.8-flash': ['gemini-3.8-flash', 'google/gemini-3.8-flash'],
  'feelfish/gemini-4-carbon': ['gemini-4-carbon', 'google/gemini-4-carbon'],
  'feelfish/gpt-6.2-sol': ['gpt-6.2-sol', 'openai/gpt-6.2-sol'],
  'feelfish/gpt-6.2-astra': ['gpt-6.2-astra', 'openai/gpt-6.2-astra'],
};
const integer = (n) => Number.isSafeInteger(n) && n >= 0;
const truncated = new Set(['length', 'max_tokens', 'MAX_TOKENS', 'model_context_window_exceeded']);

export function auditRuntime({ routes, role, mode = 'FAST', observed }) {
  const route = Object.hasOwn(routes.roles, role) ? routes.roles[role] : null;
  if (!route || !['FAST', 'STANDARD', 'DEEP'].includes(mode)) throw new Error('Unknown role or workflow mode');
  const expected = { model: route.model.modelName, effort: route.effortByMode?.[mode] ?? route.model.reasoningEffort,
    maxOutputTokens: route.cap };
  const absent = [];
  const mismatches = [];
  const compare = (key, predicate) => {
    if (observed[key] === undefined || observed[key] === null) absent.push(key);
    else if (!predicate(observed[key])) mismatches.push(key);
  };
  const known = [expected.model, ...(aliases[expected.model] ?? [])];
  compare('requestModel', (s) => known.includes(s));
  compare('actualModel', (s) => known.includes(s));
  compare('effort', (s) => s === expected.effort);
  compare('maxOutputTokens', (n) => n === expected.maxOutputTokens);
  for (const key of ['inputTokens', 'reasoningTokens', 'visibleOutputTokens']) compare(key, integer);
  compare('provider', (v) => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9 ._/-]{0,79}$/u.test(v));
  compare('requestId', (v) => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/u.test(v));
  compare('durationMs', (n) => integer(n) && n > 0);
  compare('finishReason', (s) => truncated.has(s)
    || ['stop', 'end_turn', 'stop_sequence', 'STOP', 'refusal', 'content_filter', 'tool_calls', 'tool_use'].includes(s));
  compare('cost', (v) => Number.isFinite(v.amount) && v.amount >= 0 && ['USD', 'CNY', 'credits'].includes(v.currency));
  compare('evidenceRef', (v) => typeof v === 'string' && !!v.trim());
  compare('sentSamplingParameters', (v) => Array.isArray(v) && v.length === 0);
  if (['temperature', 'top_p', 'top_k', 'topP', 'topK'].some((k) => Object.hasOwn(observed, k))) mismatches.push('samplingParameters');
  if (integer(observed.reasoningTokens) && integer(observed.visibleOutputTokens) && integer(observed.maxOutputTokens)
    && observed.reasoningTokens + observed.visibleOutputTokens > observed.maxOutputTokens) mismatches.push('outputUsageExceedsCap');
  const upstream = observed.scope === 'UPSTREAM_REQUEST_AND_RESPONSE';
  const evidence = Object.fromEntries(['requestModel', 'actualModel', 'effort', 'maxOutputTokens', 'inputTokens',
    'reasoningTokens', 'visibleOutputTokens', 'durationMs', 'finishReason', 'provider', 'requestId', 'cost'].filter((key) => !mismatches.includes(key)
    && !absent.includes(key)).map((key) => [key, key === 'cost' ? { amount: observed.cost.amount, currency: observed.cost.currency } : observed[key]]));
  return { decision: mismatches.length ? 'PARAMETER_OR_EVIDENCE_DRIFT'
    : !upstream || absent.length ? 'UNVERIFIED_RUNTIME' : 'OBSERVED_VALUES_MATCH',
  role, mode, expected, evidence, absent, mismatches, truncated: truncated.has(observed.finishReason),
  sourceScope: upstream ? 'UPSTREAM_REQUEST_AND_RESPONSE' : observed.scope === 'OFFLINE_FIXTURE' ? 'OFFLINE_FIXTURE' : 'HOST_ONLY_OR_UNSPECIFIED' };
}

if (process.argv[1] && pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url) {
  const [routesFile, role, mode, evidenceFile] = process.argv.slice(2);
  if (!evidenceFile) throw new Error('Usage: node runtime-audit.mjs <model-routes.json> <role-id> <mode> <redacted-observation.json>');
  const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
  const result = auditRuntime({ routes: json(routesFile), role, mode, observed: json(evidenceFile) });
  console.log(JSON.stringify(result, null, 2));
  if (result.decision !== 'OBSERVED_VALUES_MATCH') process.exitCode = 2;
}
