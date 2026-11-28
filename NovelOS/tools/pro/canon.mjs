import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkPacket, checkDelivery, applyEdit } from './workflow.mjs';
import { matchesRuntimeModel } from './runtime-audit.mjs';
import { validateQualityReview } from './quality-review.mjs';

const digest = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const id = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u;
const hex = /^[a-f0-9]{64}$/u;
const factKey = /^(knowledge|relationship|inventory|time|position|resource|promise|foreshadow):[\p{L}\p{N}_.:-]{1,120}$/u;
const threadId = /^[\p{L}\p{N}][\p{L}\p{N}_.:-]{0,79}$/u;
const validFactKeys = (keys, limit) => Array.isArray(keys) && keys.length <= limit
  && keys.every((key) => typeof key === 'string' && factKey.test(key));
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
const dueKeys = (head) => Object.keys(head.facts).filter((key) =>
  head.facts[key].thread?.status === 'open' && head.facts[key].thread.dueChapter <= head.chapter + 1).sort();

export function readChapterContext(root, bookId, keys = [], activeThreads = []) {
  need(validFactKeys(keys, 10), 'Request up to ten named Canon facts');
  need(Array.isArray(activeThreads) && activeThreads.length <= 10
    && activeThreads.every((value) => typeof value === 'string' && threadId.test(value)), 'Invalid active story threads');
  const head = readCanon(root, bookId);
  const unique = [...new Set(keys)];
  const facts = Object.fromEntries(unique.filter((key) => Object.hasOwn(head.facts, key)).map((key) => [key, head.facts[key]]));
  const nextChapter = head.chapter + 1;
  const relevant = Object.entries(head.facts)
    .filter(([, fact]) => fact.thread?.status === 'open')
    .map(([key, fact]) => ({ key, fact, overdue: fact.thread.dueChapter < nextChapter,
      due: fact.thread.dueChapter <= nextChapter, active: activeThreads.includes(fact.thread.id) }))
    .filter(({ due, active }) => due || active)
    .sort((a, b) => a.fact.thread.dueChapter - b.fact.thread.dueChapter || a.fact.chapter - b.fact.chapter || a.key.localeCompare(b.key));
  const suggestions = relevant.filter(({ key }) => !Object.hasOwn(facts, key));
  return { bookId, chapter: head.chapter, version: head.version, facts,
    missing: unique.filter((key) => !Object.hasOwn(facts, key)), previousTail: previousTail(head),
    dueCount: relevant.filter(({ due }) => due).length,
    dueKeys: dueKeys(head),
    suggestedEvidence: suggestions.slice(0, 10), omittedSuggestions: Math.max(0, suggestions.length - 10) };
}

function compileHandoff(base, input) {
  const { chapter, parentVersion, brief, factKeys, dueDecisions, requiresReading } = input;
  need(base.bookId === input.bookId && chapter === base.chapter + 1 && parentVersion === base.version, 'Stale chapter handoff');
  need(brief && typeof brief === 'object' && !Array.isArray(brief)
    && !['previousTail', 'hardFacts', 'duePayoffs'].some((key) => Object.hasOwn(brief, key)), 'Handoff brief cannot supply Canon prose or the previous tail');
  need(validFactKeys(factKeys, 10) && new Set(factKeys).size === factKeys.length, 'Invalid handoff fact keys');
  need(requiresReading === undefined || typeof requiresReading === 'boolean', 'Invalid independent reading requirement');
  const keys = [...factKeys].sort();
  need(keys.every((key) => Object.hasOwn(base.facts, key)), 'Handoff fact missing from approved baseline');
  const due = dueKeys(base);
  need(Array.isArray(dueDecisions) && dueDecisions.length === due.length, 'Every due story thread needs a disposition');
  const byKey = new Map(dueDecisions.map((item) => [item?.key, item]));
  const decisions = due.map((key) => {
    const item = byKey.get(key);
    need(item && typeof item.reason === 'string' && item.reason.trim() && item.reason.length <= 320
      && ['PAYOFF', 'DEFER', 'AUTHOR_REVIEW'].includes(item.action), 'Invalid or missing due disposition: ' + key);
    if (item.action === 'AUTHOR_REVIEW') throw new Error('Author decision is pending: ' + key);
    if (item.action === 'PAYOFF') need(keys.includes(key), 'Select the payoff evidence: ' + key);
    if (item.action === 'DEFER') need(Number.isSafeInteger(item.dueChapter) && item.dueChapter > chapter
      && item.dueChapter <= 99999999, 'Deferral must choose a later chapter: ' + key);
    return { key, action: item.action, reason: item.reason, ...(item.action === 'DEFER' && { dueChapter: item.dueChapter }) };
  });
  const normalizedBrief = Object.fromEntries(Object.entries(brief).sort(([a], [b]) => a.localeCompare(b, 'en')));
  const packetResult = checkPacket({ ...normalizedBrief, hardFacts: keys.map((key) => base.facts[key].value),
    duePayoffs: decisions.filter((item) => item.action === 'PAYOFF').map(({ key }) => base.facts[key].value),
    previousTail: previousTail(base) });
  need(packetResult.decision === 'PACKET_READY', 'Compiled packet failed: ' + packetResult.errors?.join(', '));
  const evidence = Object.fromEntries(keys.map((key) => [key, base.facts[key]]));
  const handoff = { bookId: base.bookId, chapter, parentVersion, brief: normalizedBrief, factKeys: keys, dueDecisions: decisions,
    ...(requiresReading !== undefined && { requiresReading }) };
  const handoffSha256 = digest(json({ handoff, packetSha256: packetResult.packetSha256, evidence }));
  return { handoff, handoffSha256, packet: packetResult.packet, packetSha256: packetResult.packetSha256, evidence };
}

export function prepareChapter(root, input) {
  need(root, 'Set NOVELOS_PRO_VAULT to an existing private Canon directory');
  return { decision: 'READY_TO_WRITE', ...compileHandoff(readCanon(root, input.bookId), input) };
}

function normalizeDeliveryReceipt(receipt) {
  const { bookId, chapter, runId, parentVersion, handoffSha256, packetSha256, rawSha256,
    scope, requestId, actualModel, effort, maxOutputTokens, finishReason } = receipt;
  need(typeof runId === 'string' && id.test(runId) && Number.isSafeInteger(chapter) && chapter > 0 && chapter <= 99999999
    && (parentVersion === 'GENESIS' || typeof parentVersion === 'string' && hex.test(parentVersion))
    && [handoffSha256, packetSha256, rawSha256].every((value) => typeof value === 'string' && hex.test(value)),
  'Invalid run receipt identity or hashes');
  need(scope === 'UPSTREAM_REQUEST_AND_RESPONSE' && typeof requestId === 'string' && /^[\w.:-]{1,160}$/u.test(requestId)
    && typeof actualModel === 'string' && /^[\w./:-]{1,160}$/u.test(actualModel)
    && ['low', 'medium', 'high'].includes(effort) && Number.isSafeInteger(maxOutputTokens) && maxOutputTokens > 0
    && typeof finishReason === 'string' && /^[a-z_]{1,48}$/iu.test(finishReason), 'Invalid captured Carbon runtime fields');
  return { bookId, chapter, runId, parentVersion, handoffSha256, packetSha256, rawSha256,
    scope, requestId, actualModel, effort, maxOutputTokens, finishReason: finishReason.toLowerCase() };
}

export function saveDeliveryReceipt(root, receipt) {
  const recorded = normalizeDeliveryReceipt(receipt);
  const dir = folder(bookRoot(root, recorded.bookId), 'receipts');
  writeOnce(path.join(dir, recorded.runId + '.json'), recorded);
  return { decision: 'DELIVERY_RECEIPT_SAVED', receiptSha256: digest(json(recorded)) };
}

function inspectDelivery(root, { runId, raw, finishReason }, prepared) {
  if (!prepared) return checkDelivery({ raw, finishReason });
  const { handoff: { bookId, chapter, parentVersion }, handoffSha256, packetSha256 } = prepared;
  need(typeof runId === 'string' && id.test(runId), 'Invalid run id');
  const dir = folder(bookRoot(root, bookId, false), 'receipts', false);
  const file = path.join(dir, runId + '.json');
  if (!fs.existsSync(file)) return checkDelivery({ raw, finishReason });
  const receipt = normalizeDeliveryReceipt(read(file));
  const delivery = checkDelivery({ raw, finishReason: receipt.finishReason });
  const { rawSha256 } = delivery;
  if (Object.entries({ bookId, chapter, runId, parentVersion, handoffSha256, packetSha256, rawSha256 })
    .some(([key, value]) => receipt[key] !== value)
    || (finishReason && finishReason.toLowerCase() !== 'unknown' && finishReason.toLowerCase() !== receipt.finishReason)) {
    return { decision: 'BLOCK_RECEIPT_MISMATCH', rawSha256 };
  }
  const { requestId, actualModel, effort, maxOutputTokens } = receipt;
  if (!matchesRuntimeModel('feelfish/gemini-4-carbon', actualModel)) {
    return { decision: 'BLOCK_MODEL_DRIFT', rawSha256, actualModel, requestId };
  }
  return { ...delivery, decision: delivery.decision === 'REVIEW_WITHOUT_STOP_RECEIPT' && delivery.finishReason !== 'unknown'
    ? 'READY_FOR_READING' : delivery.decision, receiptSha256: digest(json(receipt)), actualModel, effort, maxOutputTokens, requestId };
}

export function verifyChapterDelivery(root, input) {
  const prepared = input.handoff && prepareChapter(root, input.handoff);
  return inspectDelivery(root, input, prepared);
}

function threadMetadata(thread, oldThread, key, chapter, after) {
  if (thread === undefined) return after === null ? undefined : oldThread;
  need(after !== null && /^(promise|foreshadow):/u.test(key) && thread && typeof thread === 'object'
    && Object.keys(thread).length === 3 && typeof thread.id === 'string' && threadId.test(thread.id)
    && Number.isSafeInteger(thread.dueChapter) && thread.dueChapter > 0 && thread.dueChapter <= 99999999
    && ['open', 'resolved'].includes(thread.status), 'Invalid story thread for ' + key);
  need(oldThread || (thread.status === 'open' && thread.dueChapter > chapter),
    'New story thread must open with a future due chapter: ' + key);
  return { id: thread.id, dueChapter: thread.dueChapter, status: thread.status };
}

function inspect(root, candidate, base) {
  const { runId, bookId, chapter, parentVersion, packet, final, edit, changes, audit, evidenceKeys, handoff } = candidate;
  need(typeof runId === 'string' && id.test(runId), 'Invalid run id');
  need(bookId === base.bookId && Number.isSafeInteger(chapter) && chapter > 0 && chapter <= 99999999
    && chapter === base.chapter + 1 && parentVersion === base.version, 'Stale or wrong book chapter baseline');
  const packetResult = checkPacket(packet);
  need(packetResult.decision === 'PACKET_READY', 'Packet structure failed');
  need(!base.handoffSha256 || handoff, 'This book requires a prepared chapter handoff');
  const prepared = handoff && compileHandoff(base, handoff);
  if (prepared) {
    need(prepared.packetSha256 === packetResult.packetSha256, 'Packet differs from the prepared handoff');
    need(evidenceKeys === undefined || json(evidenceKeys) === json(prepared.handoff.factKeys), 'Candidate evidence differs from prepared handoff');
  }
  if (packet.previousTail !== undefined) {
    need(packet.previousTail === previousTail(base), 'Packet tail differs from the approved baseline');
  }
  let dependencies;
  let evidenceSha256;
  const usedKeys = prepared?.handoff.factKeys ?? evidenceKeys;
  if (usedKeys !== undefined) {
    need(validFactKeys(usedKeys, 10) && new Set(usedKeys).size === usedKeys.length, 'Invalid candidate evidence keys');
    need(usedKeys.every((key) => Object.hasOwn(base.facts, key)), 'Candidate evidence missing from approved baseline');
    const facts = Object.fromEntries([...usedKeys].sort().map((key) => [key, base.facts[key]]));
    dependencies = { facts, usesPreviousTail: Boolean(packet.previousTail) };
    evidenceSha256 = digest(json({ packetSha256: packetResult.packetSha256, dependencies }));
  }
  const delivery = inspectDelivery(root, candidate, prepared);
  need(delivery.decision !== 'BLOCK_RECEIPT_MISMATCH', 'Delivery receipt does not match this run');
  need(delivery.decision !== 'BLOCK_MODEL_DRIFT', 'Actual writer differs from the Carbon route');
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
  const finalSha256 = digest(final);
  for (const { key, before, after, quote, thread } of changes) {
    need(typeof key === 'string' && factKey.test(key) && !keys.has(key), 'Invalid or duplicate state key');
    keys.add(key);
    need((facts[key]?.value ?? null) === before, 'State change has outdated previous value: ' + key);
    need((typeof after === 'string' && after.trim() && after.length <= 700) || after === null, 'Invalid new value: ' + key);
    need(after !== null || facts[key]?.thread?.status !== 'open', 'Resolve an open story thread before removing it: ' + key);
    const nextThread = threadMetadata(thread, facts[key]?.thread, key, chapter, after);
    need(before !== after || json(nextThread) !== json(facts[key]?.thread), 'State change has no effect: ' + key);
    need(typeof quote === 'string' && quote.trim().length >= 4 && quote.length <= 320 && final.includes(quote),
      'State change quote is missing from final prose: ' + key);
    if (after === null) delete facts[key];
    else {
      const threadOrigin = nextThread && (facts[key]?.threadOrigin ?? { chapter, quote, sourceDraftSha256: finalSha256 });
      facts[key] = { value: after, chapter, quote, sourceDraftSha256: finalSha256,
        ...(nextThread && { thread: nextThread, threadOrigin }) };
    }
  }
  for (const item of prepared?.handoff.dueDecisions ?? []) {
    const fact = facts[item.key];
    if (item.action === 'PAYOFF') {
      need(fact?.chapter === chapter && fact.thread?.status === 'resolved', 'Planned payoff has no resolved state evidence: ' + item.key);
    } else {
      need(fact?.thread?.status === 'open', 'Deferred thread must remain open: ' + item.key);
      facts[item.key] = { ...fact, thread: { ...fact.thread, dueChapter: item.dueChapter } };
    }
  }
  const changesSha256 = digest(json(changes));
  const manualDeliveryReviewRequired = delivery.decision === 'REVIEW_WITHOUT_STOP_RECEIPT' || audit?.receiptSha256 === null;
  const binding = prepared && { handoffSha256: prepared.handoffSha256,
    receiptSha256: manualDeliveryReviewRequired ? null : delivery.receiptSha256 };
  return { packetSha256: packetResult.packetSha256, rawSha256: delivery.rawSha256, finalSha256, changesSha256,
    auditMatches: audit?.decision === 'PASS' && audit.parentVersion === base.version && audit.finalSha256 === finalSha256
      && audit.changesSha256 === changesSha256 && (evidenceSha256 === undefined || audit.evidenceSha256 === evidenceSha256)
      && (!binding || (audit.handoffSha256 === binding.handoffSha256 && audit.receiptSha256 === binding.receiptSha256
        && audit.rawSha256 === delivery.rawSha256))
      && typeof audit.evidenceRef === 'string' && !!audit.evidenceRef.trim(),
    ...(dependencies && { dependencies, evidenceSha256 }),
    ...(binding && { ...binding, dueDecisions: prepared.handoff.dueDecisions }),
    deliveryStatus: manualDeliveryReviewRequired ? 'REVIEW_WITHOUT_STOP_RECEIPT' : delivery.decision,
    manualDeliveryReviewRequired, facts };
}

export function saveQualityReview(root, { candidate, report }) {
  const inspected = inspect(root, candidate, readCanon(root, candidate.bookId));
  need(inspected.auditMatches, 'Matching continuity audit is required');
  const quality = validateQualityReview(candidate, inspected.dependencies, report);
  const candidateSha256 = digest(json(candidate));
  const dir = folder(bookRoot(root, candidate.bookId), 'quality-reviews');
  const qualitySha256 = digest(json(quality));
  writeOnce(path.join(dir, candidateSha256 + '.json'), { candidateSha256, qualitySha256, quality });
  return { decision: quality.hasBlocker ? 'QUALITY_BLOCKED' : 'QUALITY_REVIEW_SAVED', candidateSha256, qualitySha256 };
}

function inspectWithQuality(root, candidate, base) {
  const inspected = inspect(root, candidate, base);
  const candidateSha256 = digest(json(candidate));
  const dir = folder(bookRoot(root, candidate.bookId, false), 'quality-reviews', false);
  const file = path.join(dir, candidateSha256 + '.json');
  if (!fs.existsSync(file)) return { ...inspected, candidateSha256, qualityStatus: 'QUALITY_REPORT_MISSING' };
  const saved = read(file);
  const quality = validateQualityReview(candidate, inspected.dependencies, saved.quality);
  need(saved.candidateSha256 === candidateSha256 && saved.qualitySha256 === digest(json(quality)), 'Stored quality review version mismatch');
  return { ...inspected, candidateSha256, quality, qualitySha256: saved.qualitySha256,
    qualityStatus: quality.hasBlocker ? 'QUALITY_BLOCKED' : 'QUALITY_REVIEW_PRESENT' };
}

export function describeCandidate(root, candidate) {
  const { facts, ...result } = inspectWithQuality(root, candidate, readCanon(root, candidate.bookId));
  return result;
}
export function stageCandidate(root, candidate) {
  const artifacts = describeCandidate(root, candidate);
  need(artifacts.auditMatches, 'Matching continuity audit is required');
  need(artifacts.qualityStatus === 'QUALITY_REVIEW_PRESENT', 'Candidate quality review is missing or blocked: ' + artifacts.qualityStatus);
  saveRaw(root, candidate);
  const dir = folder(bookRoot(root, candidate.bookId), 'runs');
  writeOnce(path.join(dir, candidate.runId + '.json'), candidate);
  return { decision: 'CANDIDATE_STAGED', ...artifacts };
}

export function reviewCandidate(root, { bookId, runId }) {
  need(typeof runId === 'string' && id.test(runId), 'Invalid run id');
  const candidate = read(path.join(folder(bookRoot(root, bookId, false), 'runs', false), runId + '.json'));
  need(candidate.bookId === bookId && candidate.runId === runId, 'Saved candidate identity mismatch');
  const proof = describeCandidate(root, candidate);
  const { chapter, parentVersion, raw, final, edit, changes, audit } = candidate;
  return { decision: !proof.auditMatches ? 'AUDIT_REFRESH_REQUIRED'
    : proof.qualityStatus === 'QUALITY_REVIEW_PRESENT' ? 'AUTHOR_REVIEW_REQUIRED' : proof.qualityStatus,
    bookId, runId, chapter, parentVersion, proof, raw, final,
    edit: edit ? { before: edit.order.quote, after: edit.replacement, reason: edit.order.reason } : null,
    changes, auditReference: audit?.evidenceRef };
}

export function approveCanon(root, { bookId, runId, candidateSha256, authorRef, manualDeliveryReviewed = false, authorNotesReviewed = false }) {
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
  const checked = inspectWithQuality(root, candidate, base);
  need(checked.auditMatches, 'Matching continuity audit is required');
  need(checked.qualityStatus === 'QUALITY_REVIEW_PRESENT', 'Candidate quality review is missing or blocked: ' + checked.qualityStatus);
  need(!checked.quality.authorNotes.length || authorNotesReviewed === true, 'Author must explicitly review the open quality notes');
  need(!checked.manualDeliveryReviewRequired || manualDeliveryReviewed === true, 'Author must confirm manual completeness review');
  const body = { bookId, chapter: candidate.chapter, parentVersion: base.version,
    runId, packetSha256: checked.packetSha256, rawSha256: checked.rawSha256, finalSha256: checked.finalSha256,
    changesSha256: checked.changesSha256, candidateSha256, audit: candidate.audit, qualitySha256: checked.qualitySha256,
    ...(checked.dependencies && { dependencies: checked.dependencies, evidenceSha256: checked.evidenceSha256 }),
    ...(checked.handoffSha256 && { handoffSha256: checked.handoffSha256, receiptSha256: checked.receiptSha256,
      dueDecisions: checked.dueDecisions, deliveryStatus: checked.deliveryStatus }),
    approval: { authorRef, manualDeliveryReviewed, authorNotesReviewed, approvedAt: new Date().toISOString() },
    final: candidate.final, facts: checked.facts };
  const version = digest(json(body));
  try { append(file, { ...body, version }); }
  catch (error) { if (error.code === 'EEXIST') return existing(); throw error; }
  return { decision: 'CANON_APPROVED', chapter: candidate.chapter, version };
}

export function reviewChapterImpact(root, { bookId, sourceChapter, sourceFinalSha256, headVersion,
  changedFactKeys, previousTailChanged, proposedFinal } = {}) {
  need(root, 'Set NOVELOS_PRO_VAULT to an existing private Canon directory');
  need(Number.isSafeInteger(sourceChapter) && sourceChapter > 0 && typeof sourceFinalSha256 === 'string'
    && hex.test(sourceFinalSha256) && typeof headVersion === 'string' && hex.test(headVersion)
    && validFactKeys(changedFactKeys, 50) && (typeof previousTailChanged === 'boolean' || typeof proposedFinal === 'string'),
  'Invalid chapter impact request');
  const head = readCanon(root, bookId);
  if (head.version !== headVersion) return { decision: 'STALE_BASELINE', bookId, currentVersion: head.version };
  need(sourceChapter <= head.chapter, 'Source chapter has no approved snapshot');
  const book = bookRoot(root, bookId, false);
  const dir = folder(book, 'snapshots', false);
  const source = snapshot(dir, bookId, sourceChapter);
  if (source.finalSha256 !== sourceFinalSha256) return { decision: 'STALE_SOURCE', bookId, sourceChapter };
  let proposedFinalSha256;
  if (proposedFinal !== undefined) {
    need(typeof proposedFinal === 'string' && [...proposedFinal].length <= 30000
      && checkDelivery({ raw: proposedFinal + '\n[NOVELOS END]' }).prose === proposedFinal, 'Proposed final must be a complete chapter');
    proposedFinalSha256 = digest(proposedFinal);
    need(proposedFinalSha256 !== sourceFinalSha256, 'Proposed final matches the approved chapter');
    const actualTailChanged = previousTail(source) !== previousTail({ final: proposedFinal });
    need(previousTailChanged === undefined || previousTailChanged === actualTailChanged, 'Declared tail change differs from the proposed final');
    previousTailChanged = actualTailChanged;
  }

  const changed = [...new Set(changedFactKeys)];
  const potential = new Map();
  function reviewReasons(chapter, tracked, keys, usesPreviousTail) {
    const facts = changed.filter((key) => keys.includes(key));
    const previousTail = previousTailChanged && chapter === sourceChapter + 1 && usesPreviousTail;
    const indirect = keys.filter((key) => !facts.includes(key) && potential.has(key))
      .map((key) => ({ key, viaChapter: potential.get(key) }));
    const action = facts.length || previousTail ? 'REVIEW_DIRECT_DEPENDENCIES'
      : indirect.length ? 'REVIEW_INDIRECT_DEPENDENCIES' : tracked ? 'REVALIDATE_BASELINE' : 'REVIEW_UNTRACKED';
    return { action, facts, previousTail, indirect };
  }

  let parent = source;
  const approved = [];
  for (let chapter = sourceChapter + 1; chapter <= head.chapter; chapter += 1) {
    const entry = snapshot(dir, bookId, chapter);
    need(entry.parentVersion === parent.version, 'Broken Canon parent binding');
    const deps = entry.dependencies;
    const reasons = reviewReasons(chapter, Boolean(deps), Object.keys(deps?.facts ?? {}), deps?.usesPreviousTail === true);
    approved.push({ chapter, version: entry.version, auditEvidence: entry.audit?.evidenceRef, ...reasons });
    if (reasons.action !== 'REVALIDATE_BASELINE') {
      for (const key of new Set([...Object.keys(parent.facts), ...Object.keys(entry.facts)])) {
        if (json(parent.facts[key]) !== json(entry.facts[key]) && !potential.has(key)) potential.set(key, chapter);
      }
    }
    parent = entry;
  }
  const runs = folder(book, 'runs', false);
  const staged = [];
  if (fs.existsSync(runs)) {
    for (const file of fs.readdirSync(runs).filter((name) => name.endsWith('.json') && id.test(name.slice(0, -5)))) {
      const candidate = read(path.join(runs, file));
      if (candidate.bookId !== bookId || candidate.chapter !== head.chapter + 1 || candidate.parentVersion !== headVersion) continue;
      const keys = candidate.handoff?.factKeys ?? candidate.evidenceKeys;
      staged.push({ chapter: candidate.chapter, runId: candidate.runId, candidateSha256: digest(json(candidate)),
        ...reviewReasons(candidate.chapter, Array.isArray(keys), keys ?? [], Boolean(candidate.packet.previousTail)) });
    }
  }
  if (readCanon(root, bookId).version !== headVersion) return { decision: 'STALE_BASELINE', bookId };
  return { decision: 'REVIEW_IMPACT', bookId, sourceChapter, sourceFinalSha256, headVersion, changedFactKeys: changed,
    previousTailChanged, ...(proposedFinalSha256 && { proposedFinalSha256 }), approved, staged };
}

if (process.argv[1] && pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url) {
  const [action, root, arg, runId, candidateSha256, authorRef, ...flags] = process.argv.slice(2);
  if (!root || !arg) throw new Error('Usage: node canon.mjs raw|inspect|stage|prepare|receipt|impact <existing-vault> <input.json> | audit <vault> <candidate.json> <quality-report.json> | read <vault> <book-id> | review <vault> <book-id> <run-id> | context <vault> <book-id> [fact-keys...] | approve <vault> <book-id> <run-id> <candidate-sha256> <author-ref> [--manual-delivery-reviewed] [--author-notes-reviewed]');
  const result = action === 'raw' ? saveRaw(root, read(arg))
    : action === 'prepare' ? prepareChapter(root, read(arg))
    : action === 'receipt' ? saveDeliveryReceipt(root, read(arg))
    : action === 'audit' ? saveQualityReview(root, { candidate: read(arg), report: read(runId) })
    : action === 'impact' ? reviewChapterImpact(root, read(arg))
    : action === 'review' ? reviewCandidate(root, { bookId: arg, runId })
    : action === 'inspect' ? describeCandidate(root, read(arg))
    : action === 'stage' ? stageCandidate(root, read(arg)) : action === 'read' ? readCanon(root, arg)
      : action === 'context' ? readChapterContext(root, arg, process.argv.slice(5))
    : action === 'approve' ? approveCanon(root, { bookId: arg, runId, candidateSha256, authorRef,
        manualDeliveryReviewed: flags.includes('--manual-delivery-reviewed'), authorNotesReviewed: flags.includes('--author-notes-reviewed') }) : null;
  if (!result) throw new Error('Unknown Canon command');
  console.log(json(result).trimEnd());
}
