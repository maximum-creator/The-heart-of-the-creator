import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkPacket, checkDelivery, applyEdit } from './workflow.mjs';

const digest = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const id = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u;
const hex = /^[a-f0-9]{64}$/u;
const factKey = /^(knowledge|relationship|inventory|time|position|resource|promise|foreshadow):[\p{L}\p{N}_.:-]{1,120}$/u;
const need = (ok, message) => { if (!ok) throw new Error(message); };

function read(file) {
  need(fs.lstatSync(file).isFile(), 'Expected a regular Canon record file');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function folder(parent, name, create = true) {
  const dir = path.join(parent, name);
  if (create) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(dir)) need(fs.realpathSync(dir) === dir, 'Redirected Canon directory');
  return dir;
}
function bookRoot(root, bookId, create = true) {
  need(typeof bookId === 'string' && id.test(bookId), 'Invalid book id');
  const vault = fs.realpathSync(root);
  need(fs.statSync(vault).isDirectory(), 'Expected a Canon vault directory');
  return folder(vault, bookId, create);
}
function append(file, value) {
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    fs.writeFileSync(temporary, json(value), { flag: 'wx', flush: true });
    fs.linkSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
function writeOnce(file, value) {
  try { append(file, value); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    need(json(read(file)) === json(value), 'Run already exists with different evidence');
  }
}
const chapterFile = (dir, chapter) => path.join(dir, String(chapter).padStart(8, '0') + '.json');

function snapshot(dir, bookId, chapter) {
  if (!chapter) return { bookId, chapter: 0, version: 'GENESIS', facts: {} };
  const entry = read(chapterFile(dir, chapter));
  const { version, ...body } = entry;
  need(body.bookId === bookId && body.chapter === chapter && version === digest(json(body)), 'Corrupted Canon snapshot');
  return entry;
}
export function readCanon(root, bookId) {
  const dir = folder(bookRoot(root, bookId, false), 'snapshots', false);
  if (!fs.existsSync(dir)) return snapshot(dir, bookId, 0);
  const chapters = fs.readdirSync(dir).filter((p) => /^\d{8}\.json$/u.test(p)).map((p) => Number(p.slice(0, 8)));
  const latest = chapters.reduce((max, number) => Math.max(max, number), 0);
  need(latest === chapters.length, 'Canon snapshot sequence has a gap');
  const head = snapshot(dir, bookId, latest);
  if (latest) need(head.parentVersion === snapshot(dir, bookId, latest - 1).version, 'Broken Canon parent binding');
  return head;
}

export function saveRaw(root, { bookId, runId, chapter, parentVersion, raw, finishReason, finishEvidence }) {
  need(typeof runId === 'string' && id.test(runId) && Number.isSafeInteger(chapter) && chapter > 0 && chapter <= 99999999,
    'Invalid run identity');
  need(parentVersion === 'GENESIS' || hex.test(parentVersion ?? ''), 'Invalid parent version');
  const delivery = checkDelivery({ raw, finishReason, finishEvidence });
  const dir = folder(bookRoot(root, bookId), 'runs');
  writeOnce(path.join(dir, runId + '.raw.json'),
    { bookId, runId, chapter, parentVersion, raw, finishReason: delivery.finishReason, finishEvidence, rawSha256: delivery.rawSha256 });
  return { decision: 'RAW_SAVED', delivery: delivery.decision, rawSha256: delivery.rawSha256 };
}

const previousTail = (head) => [...(head.final ?? '')].slice(-600).join('');

export function readChapterContext(root, bookId, keys = []) {
  need(Array.isArray(keys) && keys.length <= 10 && keys.every((key) => typeof key === 'string' && factKey.test(key)),
    'Request up to ten named Canon facts');
  const head = readCanon(root, bookId);
  const unique = [...new Set(keys)];
  const facts = Object.fromEntries(unique.filter((key) => Object.hasOwn(head.facts, key)).map((key) => [key, head.facts[key]]));
  return { bookId, chapter: head.chapter, version: head.version, facts,
    missing: unique.filter((key) => !Object.hasOwn(facts, key)), previousTail: previousTail(head) };
}

function inspect(candidate, base) {
  const { runId, bookId, chapter, parentVersion, packet, raw, finishReason, finishEvidence, final, edit, changes, audit } = candidate;
  need(typeof runId === 'string' && id.test(runId), 'Invalid run id');
  need(bookId === base.bookId && Number.isSafeInteger(chapter) && chapter > 0 && chapter <= 99999999
    && chapter === base.chapter + 1 && parentVersion === base.version, 'Stale or wrong book chapter baseline');
  const packetResult = checkPacket(packet);
  need(packetResult.decision === 'PACKET_READY', 'Packet structure failed');
  if (packet.previousTail !== undefined) {
    need(packet.previousTail === previousTail(base), 'Packet tail differs from the approved baseline');
  }
  const delivery = checkDelivery({ raw, finishReason, finishEvidence });
  need(['READY_FOR_READING', 'REVIEW_WITHOUT_STOP_RECEIPT'].includes(delivery.decision), 'Incomplete or blocked raw delivery');
  if (edit) {
    const revision = applyEdit({ prose: delivery.prose, order: edit.order, replacement: edit.replacement });
    need(revision.revised === final, 'Final differs from the locked local edit');
    need(checkDelivery({ raw: final + '\n[NOVELOS END]' }).decision === 'REVIEW_WITHOUT_STOP_RECEIPT',
      'Revised final does not satisfy the prose delivery contract');
  } else need(delivery.prose === final, 'Final differs from the original without a bound edit');

  need(Array.isArray(changes) && changes.length <= 50, 'Invalid state changes');
  const keys = new Set();
  const facts = { ...base.facts };
  for (const { key, before, after, quote } of changes) {
    need(typeof key === 'string' && factKey.test(key) && !keys.has(key), 'Invalid or duplicate state key');
    keys.add(key);
    need((facts[key]?.value ?? null) === before, 'State change has outdated previous value: ' + key);
    need((typeof after === 'string' && after.trim() && after.length <= 700) || after === null, 'Invalid new value: ' + key);
    need(before !== after, 'State change has no effect: ' + key);
    need(typeof quote === 'string' && quote.trim().length >= 4 && quote.length <= 320 && final.includes(quote),
      'State change quote is missing from final prose: ' + key);
    if (after === null) delete facts[key];
    else facts[key] = { value: after, chapter, quote, sourceDraftSha256: digest(final) };
  }
  const finalSha256 = digest(final);
  const changesSha256 = digest(json(changes));
  return { packetSha256: packetResult.packetSha256, rawSha256: delivery.rawSha256, finalSha256, changesSha256,
    auditMatches: audit?.decision === 'PASS' && audit.parentVersion === base.version && audit.finalSha256 === finalSha256
      && audit.changesSha256 === changesSha256 && typeof audit.evidenceRef === 'string' && !!audit.evidenceRef.trim(),
    manualDeliveryReviewRequired: delivery.decision === 'REVIEW_WITHOUT_STOP_RECEIPT', facts };
}

export function describeCandidate(root, candidate) {
  const { facts, ...result } = inspect(candidate, readCanon(root, candidate.bookId));
  return { ...result, candidateSha256: digest(json(candidate)) };
}
export function stageCandidate(root, candidate) {
  const artifacts = describeCandidate(root, candidate);
  need(artifacts.auditMatches, 'Matching continuity audit is required');
  saveRaw(root, candidate);
  const dir = folder(bookRoot(root, candidate.bookId), 'runs');
  writeOnce(path.join(dir, candidate.runId + '.json'), candidate);
  return { decision: 'CANDIDATE_STAGED', ...artifacts };
}

export function approveCanon(root, { bookId, runId, candidateSha256, authorRef, manualDeliveryReviewed = false }) {
  need(typeof runId === 'string' && id.test(runId) && hex.test(candidateSha256 ?? ''), 'Invalid approval target');
  need(typeof authorRef === 'string' && !!authorRef.trim(), 'Explicit author approval reference is required');
  const book = bookRoot(root, bookId);
  const candidate = read(path.join(folder(book, 'runs'), runId + '.json'));
  need(candidate.bookId === bookId && candidate.runId === runId && digest(json(candidate)) === candidateSha256,
    'Approval does not match the saved candidate');
  const dir = folder(book, 'snapshots');
  const file = chapterFile(dir, candidate.chapter);
  const existing = () => {
    const winner = snapshot(dir, bookId, candidate.chapter);
    need(winner.candidateSha256 === candidateSha256, 'Concurrent or previously approved different candidate');
    return { decision: 'ALREADY_APPROVED', chapter: winner.chapter, version: winner.version };
  };
  if (fs.existsSync(file)) return existing();
  const base = readCanon(root, bookId);
  if (base.chapter >= candidate.chapter) return existing();
  const checked = inspect(candidate, base);
  need(checked.auditMatches, 'Matching continuity audit is required');
  need(!checked.manualDeliveryReviewRequired || manualDeliveryReviewed === true, 'Author must confirm manual completeness review');
  const body = { bookId, chapter: candidate.chapter, parentVersion: base.version,
    runId, packetSha256: checked.packetSha256, rawSha256: checked.rawSha256, finalSha256: checked.finalSha256,
    changesSha256: checked.changesSha256, candidateSha256, audit: candidate.audit,
    approval: { authorRef, manualDeliveryReviewed, approvedAt: new Date().toISOString() },
    final: candidate.final, facts: checked.facts };
  const version = digest(json(body));
  try { append(file, { ...body, version }); }
  catch (error) { if (error.code === 'EEXIST') return existing(); throw error; }
  return { decision: 'CANON_APPROVED', chapter: candidate.chapter, version };
}

if (process.argv[1] && pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url) {
  const [action, root, arg, runId, candidateSha256, authorRef, ...flags] = process.argv.slice(2);
  if (!root || !arg) throw new Error('Usage: node canon.mjs raw|inspect|stage <existing-vault> <candidate.json> | read <vault> <book-id> | context <vault> <book-id> [fact-keys...] | approve <vault> <book-id> <run-id> <candidate-sha256> <author-ref> [--manual-delivery-reviewed]');
  const result = action === 'raw' ? saveRaw(root, read(arg))
    : action === 'inspect' ? describeCandidate(root, read(arg))
    : action === 'stage' ? stageCandidate(root, read(arg)) : action === 'read' ? readCanon(root, arg)
      : action === 'context' ? readChapterContext(root, arg, process.argv.slice(5))
    : action === 'approve' ? approveCanon(root, { bookId: arg, runId, candidateSha256, authorRef,
        manualDeliveryReviewed: flags.includes('--manual-delivery-reviewed') }) : null;
  if (!result) throw new Error('Unknown Canon command');
  console.log(json(result).trimEnd());
}
