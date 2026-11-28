import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const hash = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const bounded = (value, max) => typeof value === 'string' && Boolean(value.trim()) && value.length <= max;
const need = (ok, message) => { if (!ok) throw new Error(message); };
const labels = ['AI_VOICE', 'DIRECT_EXPOSITION', 'REDUNDANCY'];
const impacts = ['SURFACE', 'SCENE', 'CANON'];

function locate(prose, target = {}) {
  let start;
  let end;
  if (Object.hasOwn(target, 'quote')) {
    need(bounded(target.quote, 1400) && !Object.hasOwn(target, 'firstLine') && !Object.hasOwn(target, 'lastLine'),
      'Select an exact quote or a line range');
    start = prose.indexOf(target.quote);
    need(start >= 0 && prose.indexOf(target.quote, start + 1) < 0, 'Selected quote is missing or ambiguous; select its line range');
    end = start + target.quote.length;
  } else {
    const starts = [0, ...Array.from(prose.matchAll(/\n/gu), (match) => match.index + 1)];
    const { firstLine, lastLine } = target;
    need(Number.isSafeInteger(firstLine) && Number.isSafeInteger(lastLine) && firstLine >= 1
      && lastLine >= firstLine && lastLine <= starts.length && lastLine - firstLine < 12, 'Invalid rework line range');
    start = starts[firstLine - 1];
    end = starts[lastLine] ?? prose.length;
    while (end > start && (prose[end - 1] === '\r' || prose[end - 1] === '\n')) end -= 1;
  }
  const quote = prose.slice(start, end);
  const firstContent = prose.search(/\S/u);
  const titleEnd = prose.indexOf('\n', firstContent);
  need(titleEnd >= 0 && start > titleEnd && bounded(quote, 1400), 'Rework must select a nonempty passage after the title');
  return { start, end, quote, line: prose.slice(0, start).split('\n').length };
}

export function planAuthorRework({ prose, proseSha256, issues } = {}) {
  need(bounded(prose, 30000) && hash(prose) === proseSha256, 'Rework source version mismatch');
  need(Array.isArray(issues) && issues.length >= 1 && issues.length <= 5, 'Choose one to five scoped rework issues');
  const entries = issues.map((item, index) => {
    const { target, authorNote, categories, impact, diagnosis, preserve, strategy } = item ?? {};
    need(bounded(authorNote, 500) && bounded(diagnosis, 500) && bounded(strategy, 500), 'Keep the author feedback, local cause and revision approach');
    need(Array.isArray(categories) && categories.length > 0 && new Set(categories).size === categories.length
      && categories.every((value) => labels.includes(value)) && impacts.includes(impact), 'Invalid author rework category or impact');
    need(Array.isArray(preserve) && preserve.length >= 1 && preserve.length <= 5
      && preserve.every((value) => bounded(value, 200)), 'List the narrative functions or facts that must remain');
    return { id: 'issue-' + (index + 1), target, authorNote, categories, impact, diagnosis, preserve, strategy, ...locate(prose, target) };
  });
  const positioned = [...entries].sort((a, b) => a.start - b.start);
  need(positioned.every((item, index) => index === 0 || item.start >= positioned[index - 1].end), 'Overlapping issues must be combined before rework');
  if (entries.some(({ impact }) => impact === 'CANON')) return { decision: 'RETURN_TO_CONTINUITY', proseSha256, issues: entries };
  if (entries.some(({ impact }) => impact === 'SCENE')) return { decision: 'RETURN_TO_ARCHITECT', proseSha256, issues: entries };
  const order = { kind: 'AUTHOR_REWORK', proseSha256, issues: entries };
  return { decision: 'AUTHOR_REWORK_READY', order: { ...order, orderSha256: hash(JSON.stringify(order)) } };
}

export function applyAuthorRework({ prose, order, replacement } = {}) {
  need(order?.kind === 'AUTHOR_REWORK', 'Expected an author rework order');
  const { order: current } = planAuthorRework({ prose, proseSha256: order.proseSha256, issues: order.issues });
  need(current?.orderSha256 === order.orderSha256 && current.issues.every((item, index) =>
    ['id', 'start', 'end', 'quote', 'line'].every((field) => item[field] === order.issues[index][field])),
  'Author rework order is stale or altered');
  const { editorRef, patches } = replacement ?? {};
  need(bounded(editorRef, 100) && Array.isArray(patches) && patches.length === current.issues.length
    && new Set(patches.map((item) => item?.id)).size === patches.length, 'Provide an editor and one replacement per issue');
  const replacements = new Map(patches.map((item) => [item.id, item.text]));
  let cursor = 0;
  let revised = '';
  const changes = [];
  for (const item of [...current.issues].sort((a, b) => a.start - b.start)) {
    const after = replacements.get(item.id);
    need(typeof after === 'string' && after.length <= 1600 && after !== item.quote
      && !after.includes('[NOVELOS END]') && (after === '' || Boolean(after.trim())), 'Invalid replacement for ' + item.id);
    revised += prose.slice(cursor, item.start);
    const revisedStart = revised.length;
    revised += after;
    changes.push({ id: item.id, line: item.line, before: item.quote, after, revisedStart });
    cursor = item.end;
  }
  revised += prose.slice(cursor);
  const titleEnd = revised.indexOf('\n', revised.search(/\S/u));
  need(bounded(revised, 30000) && titleEnd >= 0 && revised.slice(titleEnd + 1).trim(), 'Rework must retain a body after the title');
  const receipt = { proseSha256: current.proseSha256, orderSha256: current.orderSha256, revisedSha256: hash(revised), editorRef, changes };
  return { decision: 'AUTHOR_REWORK_APPLIED', ...receipt, reworkSha256: hash(JSON.stringify(receipt)), revised };
}

export function checkAuthorRework({ prose, order, replacement, report } = {}) {
  const applied = applyAuthorRework({ prose, order, replacement });
  const { reviewer, reworkSha256, findings } = report ?? {};
  need(bounded(reviewer, 100), 'Missing independent rework report');
  need(reviewer.trim().toLowerCase() !== applied.editorRef.trim().toLowerCase(), 'Rework must be checked by a different reviewer');
  need(reworkSha256 === applied.reworkSha256 && Array.isArray(findings) && findings.length === applied.changes.length
    && new Set(findings.map((item) => item?.id)).size === findings.length, 'Review must match the rework and cover every issue');
  const checked = applied.changes.map((change) => {
    const finding = findings.find(({ id }) => id === change.id);
    const outcomes = ['PASS', 'AUTHOR_REVIEW', 'BLOCK'];
    need(finding && outcomes.includes(finding.decision) && bounded(finding.result, 500), 'Explain the reader effect for ' + change.id);
    const preserve = order.issues.find(({ id }) => id === change.id).preserve;
    need(Array.isArray(finding.preservation) && finding.preservation.length === preserve.length
      && preserve.every((constraint, i) => finding.preservation[i]?.constraint === constraint
        && outcomes.includes(finding.preservation[i].decision) && bounded(finding.preservation[i].note, 500)),
    'Review every protected function or fact for ' + change.id);
    need(change.after === '' ? finding.quote === null : bounded(finding.quote, 320) && change.after.includes(finding.quote),
      'Review evidence must match the replacement or explicitly record deletion');
    const preservation = finding.preservation.map(({ constraint, decision, note }) => ({ constraint, decision, note }));
    const decisions = [finding.decision, ...preservation.map((item) => item.decision)];
    const decision = outcomes.findLast((value) => decisions.includes(value));
    return { id: change.id, decision, quote: finding.quote, result: finding.result, preservation };
  });
  return { decision: checked.some((item) => item.decision === 'BLOCK') ? 'REWORK_BLOCKED' : 'REWORK_REVIEWED',
    reviewer, reworkSha256, findings: checked };
}

export function rollbackAuthorRework({ revised, receipt } = {}) {
  need(bounded(revised, 30000) && hash(revised) === receipt?.revisedSha256 && Array.isArray(receipt?.changes),
    'Rollback target differs from the reviewed edit');
  const { proseSha256, orderSha256, revisedSha256, editorRef, changes } = receipt;
  need(hash(JSON.stringify({ proseSha256, orderSha256, revisedSha256, editorRef, changes })) === receipt.reworkSha256,
    'Rollback receipt was altered');
  let original = revised;
  for (const { revisedStart, before, after } of [...receipt.changes].reverse()) {
    need(Number.isSafeInteger(revisedStart) && revisedStart >= 0 && typeof before === 'string' && typeof after === 'string'
      && original.slice(revisedStart, revisedStart + after.length) === after, 'Rollback patch does not match the draft');
    original = original.slice(0, revisedStart) + before + original.slice(revisedStart + after.length);
  }
  need(hash(original) === receipt.proseSha256, 'Rollback did not reproduce the original draft');
  return { decision: 'ORIGINAL_RECOVERED', proseSha256: receipt.proseSha256, original };
}

if (process.argv[1] && pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url) {
  const [action, inputFile] = process.argv.slice(2);
  const actions = { plan: planAuthorRework, apply: applyAuthorRework, check: checkAuthorRework, rollback: rollbackAuthorRework };
  if (!Object.hasOwn(actions, action) || !inputFile) throw new Error('Usage: node rework.mjs plan|apply|check|rollback <input.json>');
  const args = JSON.parse(fs.readFileSync(inputFile, 'utf8').replace(/^\uFEFF/u, ''));
  console.log(JSON.stringify(actions[action](args), null, 2));
}
