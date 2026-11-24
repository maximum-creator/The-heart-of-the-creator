import { createHash } from 'node:crypto';
import { auditRawProseDelivery } from '../eval/raw-prose-delivery-audit.mjs';

const endMarker = '[NOVELOS END]';
const titlePattern = /^(?=.{1,80}$)(?:第[\p{L}\p{N}]{1,10}[章回节][ \t·：:]*)?(?=.*[\p{L}\p{N}])[\p{L}\p{N} \t·：:，、—–—（）()《》「」“”‘’\-]+$/u;
const required = ['viewpoint', 'openingPressure', 'readerPromise', 'choiceAndCost', 'endChange'];
const count = (s) => [...s].length;
const digest = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const bounded = (value, min, max) => typeof value === 'string' && count(value.trim()) >= min && count(value) <= max;
const list = (value, min, max, cap) => Array.isArray(value) && value.length >= min && value.length <= max
  && value.every((x) => bounded(x, 1, cap));

export function checkPacket(packet = {}) {
  const errors = [];
  for (const key of required) if (!bounded(packet[key], 1, 450)) errors.push(key);
  if (!list(packet.hardFacts, 1, 10, 250)) errors.push('hardFacts');
  if (!list(packet.openChoices, 1, 5, 220)) errors.push('openChoices');
  if (packet.voiceNotes !== undefined && !list(packet.voiceNotes, 0, 3, 80)) errors.push('voiceNotes');
  if (packet.previousTail !== undefined && !bounded(packet.previousTail, 0, 600)) errors.push('previousTail');
  const known = [...required, 'hardFacts', 'openChoices', 'voiceNotes', 'previousTail'];
  const unknown = Object.keys(packet).filter((key) => !known.includes(key));
  if (unknown.length) errors.push('unexpected: ' + unknown.join(', '));
  const text = JSON.stringify(packet);
  if (count(text) > 3600) errors.push('packetLength');
  if (errors.length) return { decision: 'BLOCK_PACKET', errors };
  return { decision: 'PACKET_READY', chars: count(text), packetSha256: digest(text), packet };
}

export function checkDelivery({ raw, finishReason, finishEvidence } = {}) {
  if (!bounded(raw, 1, 30000)) throw new Error('Missing or oversized raw response');
  const rawSha256 = digest(raw);
  const stop = String(finishReason ?? 'unknown').toLowerCase();
  const observedStop = finishEvidence?.scope === 'UPSTREAM_RESPONSE'
    && typeof finishEvidence.reference === 'string' && !!finishEvidence.reference.trim();
  if (!['stop', 'end_turn', 'stop_sequence', 'unknown'].includes(stop)) {
    return { decision: 'INCOMPLETE_RAW', rawSha256, finishReason: stop };
  }
  const lines = raw.trimEnd().split(/\r?\n/u);
  if (lines.at(-1) !== endMarker || lines.slice(0, -1).some((line) => line.includes(endMarker))) {
    return { decision: 'INCOMPLETE_RAW', rawSha256, finishReason: stop, reason: 'Expected a unique final boundary line' };
  }
  const prose = raw.trimEnd().slice(0, -endMarker.length).trimEnd();
  const audit = auditRawProseDelivery(prose, 'stdin', { titlePattern });
  if (audit.failures.length || /[，、：；,:;]$/u.test(prose)) {
    return { decision: 'BLOCK_DELIVERY', rawSha256, finishReason: stop, failures: audit.failures, endsMidClause: /[，、：；,:;]$/u.test(prose) };
  }
  return { decision: stop === 'unknown' || !observedStop ? 'REVIEW_WITHOUT_STOP_RECEIPT' : 'READY_FOR_READING',
    rawSha256, proseSha256: digest(prose), finishReason: stop, prose };
}

export function lockIssue({ prose, proseSha256, kind, quote, reason } = {}) {
  if (!bounded(prose, 1, 30000) || digest(prose) !== proseSha256) throw new Error('Original prose hash mismatch');
  if (kind === 'KEEP') return { decision: 'KEEP', proseSha256 };
  if (!['LOCAL', 'STRUCTURAL'].includes(kind)) throw new Error('Unknown review disposition');
  if (!bounded(quote, 4, 320) || /[\r\n]/u.test(quote) || !bounded(reason, 8, 500)) throw new Error('A single-line quote and concrete reason are required');
  const start = prose.indexOf(quote);
  if (start < 0 || prose.indexOf(quote, start + 1) >= 0) throw new Error('Quote must occur exactly once');
  const line = prose.slice(0, start).split('\n').length;
  const review = { proseSha256, kind, quote, reason, start, end: start + quote.length, line };
  if (kind === 'STRUCTURAL') return { decision: 'RETURN_TO_ARCHITECT', review };
  return { decision: 'LOCAL_EDIT_READY', order: { ...review, orderSha256: digest(JSON.stringify(review)) } };
}

export function applyEdit({ prose, order, replacement } = {}) {
  if (!order || order.kind !== 'LOCAL') throw new Error('A locked local order is required');
  const current = lockIssue({ ...order, prose }).order;
  if (current.orderSha256 !== order.orderSha256 || current.start !== order.start || current.end !== order.end) throw new Error('Revision order is stale or was altered');
  if (!bounded(replacement, 0, 420) || /[\r\n]/u.test(replacement) || replacement.includes(endMarker)
    || replacement === current.quote) throw new Error('Edit must be one changed local replacement');
  const revised = prose.slice(0, current.start) + replacement + prose.slice(current.end);
  return { decision: 'LOCAL_EDIT_APPLIED', proseSha256: current.proseSha256, orderSha256: current.orderSha256,
    revisedSha256: digest(revised), line: current.line, before: current.quote, after: replacement, revised };
}
