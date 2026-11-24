import readline from 'node:readline';
import { checkPacket, checkDelivery, lockIssue, applyEdit } from './workflow.mjs';
import { chapterPlanSchema, planChapter } from './dispatch.mjs';

const str = { type: 'string' };
const object = { type: 'object' };
const props = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const tools = [
  ['novelos_pro_plan_chapter', 'Plan one chapter from the matching approved Canon baseline and return the named evidence with source quotes.', chapterPlanSchema,
    (args) => planChapter(process.env.NOVELOS_PRO_VAULT, args)],
  ['novelos_pro_check_packet', 'Check a minimal scene packet before writing.', props({ packet: object }, ['packet']), ({ packet }) => checkPacket(packet)],
  ['novelos_pro_check_delivery', 'Preserve raw identity and detect incomplete delivery before prose review.', props({ raw: str, finishReason: str, finishEvidence: object }, ['raw']), checkDelivery],
  ['novelos_pro_lock_issue', 'Bind one unique quote and reading issue to the original prose.', props({ prose: str, proseSha256: str, kind: { enum: ['KEEP', 'LOCAL', 'STRUCTURAL'] }, quote: str, reason: str }, ['prose', 'proseSha256', 'kind']), lockIssue],
  ['novelos_pro_apply_edit', 'Return a one-span revision while freezing the rest of the prose.', props({ prose: str, order: object, replacement: str }, ['prose', 'order', 'replacement']), applyEdit],
];
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const loop = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of loop) {
  let request;
  try { request = JSON.parse(line); }
  catch { send({ id: null, error: { code: -32700, message: 'Invalid JSON' } }); continue; }
  if (request.id === undefined) continue;
  const { id, method, params } = request;
  if (method === 'initialize') {
    send({ id, result: { protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'].includes(params?.protocolVersion) ? params.protocolVersion : '2024-11-05',
      serverInfo: { name: 'novelos-pro', version: '1.3.0' }, capabilities: { tools: {} } } });
  } else if (method === 'ping') send({ id, result: {} });
  else if (method === 'tools/list') send({ id, result: { tools: tools.map(([name, description, inputSchema]) => ({ name, description, inputSchema })) } });
  else if (method === 'tools/call') {
    const action = tools.find(([name]) => name === params?.name);
    if (!action) { send({ id, error: { code: -32602, message: 'Unknown NovelOS Pro tool' } }); continue; }
    try {
      const result = action[3](params?.arguments ?? {});
      send({ id, result: { isError: false, content: [{ type: 'text', text: JSON.stringify(result) }] } });
    } catch (error) { send({ id, result: { isError: true, content: [{ type: 'text', text: error.message }] } }); }
  } else send({ id, error: { code: -32601, message: 'Unknown method' } });
}
