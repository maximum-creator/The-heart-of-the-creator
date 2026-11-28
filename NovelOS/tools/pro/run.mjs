import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  describeCandidate, listWorkflowDrafts, prepareChapter, readCanon, readReworkHistory, readSavedCandidate, readSavedRaw,
  saveQualityReview, saveRaw, saveReworkVersion, verifyChapterDelivery, workflowRecord,
} from './canon.mjs';
import { planChapter } from './dispatch.mjs';
import { applyAuthorRework, planAuthorRework } from './rework.mjs';

const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const need = (ok, message) => { if (!ok) throw new Error(message); };
const present = (value) => typeof value === 'string' && !!value.trim();

function preparedRun(root, input) {
  const record = workflowRecord(root, input, 'prepare');
  need(record && record.sha256 === input.runSha256, 'Prepared run is missing or its receipt does not match');
  return record.payload;
}

function sameBaseline(root, { bookId, chapter, parentVersion }) {
  const canon = readCanon(root, bookId);
  return canon.version === parentVersion && canon.chapter + 1 === chapter;
}

function currentRun(root, input) {
  const { prepared } = preparedRun(root, input);
  need(sameBaseline(root, prepared.handoff), 'Stale run baseline; refresh the chapter plan');
  return prepared;
}

function writerTask(record, reused) {
  const { plan, prepared } = record.payload;
  return { decision: 'READY_TO_WRITE', bookId: record.bookId, runId: record.runId, runSha256: record.sha256,
    reused, dispatch: plan.dispatch, packet: prepared.packet, packetSha256: prepared.packetSha256,
    handoffSha256: prepared.handoffSha256 };
}

export function prepareRun(root, input) {
  const { bookId, plan: chapterPlan, brief, dueDecisions, castActions, preDraftRefs } = input;
  need(chapterPlan && typeof chapterPlan === 'object' && !Array.isArray(chapterPlan), 'Supply the chapter plan arguments');
  const requestSha256 = digest({ bookId, chapterPlan, brief, dueDecisions, castActions, preDraftRefs });
  const existing = workflowRecord(root, input, 'prepare');
  if (existing) {
    need(existing.payload.requestSha256 === requestSha256, 'Run is already bound to different chapter inputs');
    need(sameBaseline(root, existing.payload.prepared.handoff), 'Stale run baseline; refresh the chapter plan');
    return writerTask(existing, true);
  }
  const planned = planChapter(root, { ...chapterPlan, bookId });
  if (planned.decision !== 'READY_FOR_HANDOFF') return planned;
  const planSha256 = digest(planned);
  const pending = planned.dispatch.beforeDraft.filter((role) => {
    const review = preDraftRefs?.[role];
    return review?.planSha256 !== planSha256 || review.decision !== 'PASS' || !present(review.evidenceRef);
  });
  if (pending.length) return { decision: 'PRE_DRAFT_REVIEW_REQUIRED', pending, planSha256, plan: planned };
  if (!brief) return { decision: 'BRIEF_REQUIRED', planSha256, plan: planned };
  const prepared = prepareChapter(root, { bookId, chapter: planned.chapter, parentVersion: planned.parentVersion,
    brief, factKeys: chapterPlan.requiredFactKeys, dueDecisions, requiresReading: planned.requiresReading,
    sceneMode: chapterPlan.sceneMode, castActions });
  const record = workflowRecord(root, input, 'prepare', { requestSha256, plan: planned, prepared, preDraftRefs });
  need(sameBaseline(root, prepared.handoff), 'Canon advanced while preparing this run');
  return writerTask(record, false);
}

export function captureRun(root, input) {
  const { prepared } = preparedRun(root, input);
  const { runId, raw, finishReason, finishEvidence } = input;
  const saved = saveRaw(root, { ...prepared.handoff, runId, raw, finishReason, finishEvidence });
  workflowRecord(root, input, 'capture', { runSha256: input.runSha256, rawSha256: saved.rawSha256 });
  if (!sameBaseline(root, prepared.handoff)) return { ...saved, decision: 'RAW_SAVED_BASELINE_STALE' };
  const delivery = verifyChapterDelivery(root, { runId, raw, finishReason, handoff: prepared.handoff });
  return { ...saved, delivery: delivery.decision, proseSha256: delivery.proseSha256,
    receiptSha256: delivery.receiptSha256 ?? null };
}

function matchingParent(root, input, prepared, candidateSha256) {
  const source = readSavedCandidate(root, { ...input, candidateSha256 });
  need(source.handoff && source.chapter === prepared.handoff.chapter && source.parentVersion === prepared.handoff.parentVersion
    && digest(source.handoff) === digest(prepared.handoff)
    && digest(source.packet) === digest(prepared.packet), 'Rework source belongs to a different prepared chapter');
  return source;
}

export function prepareRework(root, input) {
  const prepared = currentRun(root, input);
  const { candidateSha256, issues } = input;
  const source = matchingParent(root, input, prepared, candidateSha256);
  const result = planAuthorRework({ prose: source.final, proseSha256: describeCandidate(root, source).finalSha256, issues });
  if (result.decision !== 'AUTHOR_REWORK_READY') return result;
  const { order } = result;
  const edit = { candidateSha256, order };
  const record = workflowRecord(root, input, 'edit-' + digest(edit), edit);
  return { ...result, candidateSha256, editReceipt: record.step.slice(5) };
}

export function prepareDraft(root, input) {
  const prepared = currentRun(root, input);
  const capture = workflowRecord(root, input, 'capture')?.payload;
  need(capture?.runSha256 === input.runSha256 && capture.rawSha256 === input.rawSha256,
    'Capture the exact original in this prepared run before reviewing it');
  const raw = readSavedRaw(root, input);
  need(raw.chapter === prepared.handoff.chapter && raw.parentVersion === prepared.handoff.parentVersion
    && raw.rawSha256 === input.rawSha256, 'Draft does not match the captured original');
  const delivery = verifyChapterDelivery(root, { ...raw, handoff: prepared.handoff });
  if (!['READY_FOR_READING', 'REVIEW_WITHOUT_STOP_RECEIPT'].includes(delivery.decision)) {
    return { decision: delivery.decision, rawSha256: raw.rawSha256 };
  }
  const { bookId, chapter, parentVersion, runId, finishReason, finishEvidence } = raw;
  const candidate = { bookId, chapter, parentVersion, runId, finishReason, finishEvidence, raw: raw.raw,
    handoff: prepared.handoff, packet: prepared.packet, final: delivery.prose, changes: input.changes };
  let rework;
  if (input.editReceipt !== undefined) {
    const record = workflowRecord(root, input, 'edit-' + input.editReceipt);
    need(record, 'Rework task receipt was not found in this run');
    const { candidateSha256, order } = record.payload;
    const source = matchingParent(root, input, prepared, candidateSha256);
    rework = applyAuthorRework({ prose: source.final, order, replacement: input.replacement });
    candidate.parentCandidateSha256 = candidateSha256;
    candidate.edit = { order, replacement: input.replacement };
    candidate.final = rework.revised;
  } else need(input.replacement === undefined, 'Lock the rework task before supplying replacements');
  const proof = describeCandidate(root, candidate);
  const payload = { candidate, receiptSha256: proof.receiptSha256 };
  const draftSha256 = digest(payload);
  workflowRecord(root, input, 'draft-' + draftSha256, payload);
  need(sameBaseline(root, prepared.handoff), 'Canon advanced while preparing the draft');
  return { decision: 'REVIEW_REQUIRED', draftSha256, final: candidate.final, changes: candidate.changes, proof,
    ...(rework && { reworkSha256: rework.reworkSha256, reworkChanges: rework.changes }) };
}

export function reviewDraft(root, input) {
  currentRun(root, input);
  need(input.report && typeof input.report === 'object', 'Supply an independent report for this draft');
  const { draftSha256, ...report } = input.report;
  const record = workflowRecord(root, input, 'draft-' + draftSha256);
  need(record, 'Review references a draft that was not prepared in this run');
  const { candidate, receiptSha256 } = record.payload;
  const proof = describeCandidate(root, candidate);
  need(proof.receiptSha256 === receiptSha256, 'Delivery evidence changed; prepare the draft again');
  const reviewed = { ...candidate, audit: { decision: 'PASS', parentVersion: candidate.parentVersion,
    evidenceRef: 'local-run/' + draftSha256, finalSha256: proof.finalSha256, rawSha256: proof.rawSha256,
    changesSha256: proof.changesSha256, evidenceSha256: proof.evidenceSha256, handoffSha256: proof.handoffSha256,
    receiptSha256 } };
  const quality = saveQualityReview(root, { candidate: reviewed, report });
  const saved = saveReworkVersion(root, reviewed);
  return { decision: quality.decision === 'QUALITY_BLOCKED' ? 'QUALITY_BLOCKED' : 'AUTHOR_REVIEW_REQUIRED',
    draftSha256, candidateSha256: saved.candidateSha256, qualitySha256: quality.qualitySha256,
    eventSha256: saved.eventSha256, manualDeliveryReviewRequired: proof.manualDeliveryReviewRequired };
}

export function runStatus(root, { bookId, runId }) {
  const target = { bookId, runId };
  const record = workflowRecord(root, target, 'prepare');
  if (!record) return { decision: 'RUN_NOT_PREPARED', ...target };
  const { handoff } = record.payload.prepared;
  const head = readCanon(root, bookId);
  const active = head.version === handoff.parentVersion && head.chapter + 1 === handoff.chapter;
  const capture = workflowRecord(root, target, 'capture')?.payload;
  const { decisionHistoryHead, versions } = readReworkHistory(root, target);
  return { decision: active ? 'RUN_ACTIVE' : 'RUN_BASELINE_CLOSED', ...target, chapter: handoff.chapter,
    parentVersion: handoff.parentVersion, currentVersion: head.version, runSha256: record.sha256,
    ...(capture && { rawSha256: capture.rawSha256 }), draftHashes: listWorkflowDrafts(root, target),
    decisionHistoryHead, versions };
}

if (process.argv[1] && pathToFileURL(fs.realpathSync(process.argv[1])).href === import.meta.url) {
  try {
    const [command, vault, inputFile, ...extra] = process.argv.slice(2);
    const commands = { prepare: prepareRun, capture: captureRun, 'rework-plan': prepareRework,
      draft: prepareDraft, audit: reviewDraft, status: runStatus };
    need(Object.hasOwn(commands, command) && vault && inputFile && extra.length === 0,
      'Usage: node run.mjs prepare|capture|rework-plan|draft|audit|status <vault> <input.json|->');
    const input = JSON.parse(fs.readFileSync(inputFile === '-' ? 0 : inputFile, 'utf8').replace(/^\uFEFF/u, ''));
    need(input && typeof input === 'object' && !Array.isArray(input), 'Expected a workflow input JSON object');
    console.log(JSON.stringify(commands[command](vault, input), null, 2));
  } catch (error) {
    process.stderr.write(error.message + '\n');
    process.exitCode = 1;
  }
}
