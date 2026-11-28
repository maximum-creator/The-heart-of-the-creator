import readline from 'node:readline';
import { checkPacket, lockIssue, applyEdit } from './workflow.mjs';
import { chapterPlanSchema, planChapter } from './dispatch.mjs';
import { prepareChapter, reviewChapterImpact, verifyChapterDelivery } from './canon.mjs';
import { evaluateWorkReadiness } from './work-readiness.mjs';
import { planAuthorRework, checkAuthorRework } from './rework.mjs';

const str = { type: 'string' };
const object = { type: 'object' };
const props = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const tools = [
  ['novelos_pro_evaluate_work', 'Route a novel, vertical drama, long drama or comic drama work order and check its review evidence.', props({
    format: { enum: ['NOVEL', 'VERTICAL_DRAMA', 'LONG_DRAMA', 'COMIC_DRAMA'] }, story: object, unit: object, review: object, artifact: str,
  }, ['format', 'story', 'unit']), evaluateWorkReadiness],
  ['novelos_pro_plan_chapter', 'Plan one chapter with approved evidence, relevant story threads and due payoffs.', chapterPlanSchema,
    (args) => planChapter(process.env.NOVELOS_PRO_VAULT, args)],
  ['novelos_pro_prepare_chapter', 'Compile the writer packet from approved facts and explicit decisions for all due threads.', props({
    bookId: str, chapter: { type: 'integer', minimum: 1 }, parentVersion: str, brief: object,
    factKeys: { type: 'array', maxItems: 10, items: str }, dueDecisions: { type: 'array', items: object }, requiresReading: { type: 'boolean' },
  }, ['bookId', 'chapter', 'parentVersion', 'brief', 'factKeys', 'dueDecisions']),
    (args) => prepareChapter(process.env.NOVELOS_PRO_VAULT, args)],
  ['novelos_pro_review_impact', 'Preview the impact of a proposed old-chapter change on approved chapters and staged candidates.', props({
    bookId: str, sourceChapter: { type: 'integer', minimum: 1 }, sourceFinalSha256: str, headVersion: str,
    changedFactKeys: { type: 'array', maxItems: 50, items: str }, previousTailChanged: { type: 'boolean' }, proposedFinal: str,
  }, ['bookId', 'sourceChapter', 'sourceFinalSha256', 'headVersion', 'changedFactKeys']),
    (args) => reviewChapterImpact(process.env.NOVELOS_PRO_VAULT, args)],
  ['novelos_pro_check_packet', 'Check a minimal scene packet before writing.', props({ packet: object }, ['packet']), ({ packet }) => checkPacket(packet)],
  ['novelos_pro_check_delivery', 'Check raw delivery and look up a locally captured receipt for the exact prepared run.', props({
    raw: str, finishReason: str, finishEvidence: object, handoff: object, runId: str,
  }, ['raw']), (args) => verifyChapterDelivery(process.env.NOVELOS_PRO_VAULT, args)],
  ['novelos_pro_lock_issue', 'Bind one unique quote and reading issue to the original prose.', props({ prose: str, proseSha256: str, kind: { enum: ['KEEP', 'LOCAL', 'STRUCTURAL'] }, quote: str, reason: str }, ['prose', 'proseSha256', 'kind']), lockIssue],
  ['novelos_pro_apply_edit', 'Apply a locked single edit or an author-scoped rework batch.', props({
    prose: str, order: object, replacement: { anyOf: [str, object] },
  }, ['prose', 'order', 'replacement']), applyEdit],
  ['novelos_pro_plan_rework', 'Lock up to five author-selected passages and route structural or Canon changes to review.', props({
    prose: str, proseSha256: str, issues: { type: 'array', maxItems: 5, items: object },
  }, ['prose', 'proseSha256', 'issues']), planAuthorRework],
  ['novelos_pro_check_rework', 'Check every replacement against its author feedback and require a separate reviewer.', props({
    prose: str, order: object, replacement: object, report: object,
  }, ['prose', 'order', 'replacement', 'report']), checkAuthorRework],
];
const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const loop = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of loop) {
  let request;
  try { request = JSON.parse(line); }
  catch { send({ id: null, error: { code: -32700, message: 'Invalid JSON' } }); continue; }
  if (!request || typeof request !== 'object' || Array.isArray(request) || request.jsonrpc !== '2.0'
    || typeof request.method !== 'string' || (Object.hasOwn(request, 'id') && !['string', 'number'].includes(typeof request.id))) {
    send({ id: null, error: { code: -32600, message: 'Invalid JSON-RPC request' } });
    continue;
  }
  if (request.id === undefined) continue;
  const { id, method, params } = request;
  if (method === 'initialize') {
    send({ id, result: { protocolVersion: ['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25'].includes(params?.protocolVersion) ? params.protocolVersion : '2024-11-05',
      serverInfo: { name: 'novelos-pro', version: '1.9.0' }, capabilities: { tools: {} } } });
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
