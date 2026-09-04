#!/usr/bin/env node

import fs from "node:fs";

export function auditT08(text, source = "stdin") {
  const body = text.replace(/^\s*#{1,6}\s+.*$/gm, "").trim();
  const hanChars = (body.match(/[\u3400-\u9fff]/g) || []).length;
  const paragraphs = body.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean);
  const head = body.slice(0, 500);
  const tail = paragraphs.slice(-4).join("\n");
  const failures = [];
  const reviews = [];
  const has = (regex, value = body) => regex.test(value);

  if (hanChars < 1400 || hanChars > 1800) failures.push({ code: "LENGTH_OUT_OF_RANGE", evidence: `${hanChars} Han characters; required 1400-1800` });
  if (!has(/(?:十八分钟|18分钟|一点四十二|01:42).{0,80}(?:火|烧|大火)|(?:火|大火).{0,80}(?:十八分钟|18分钟|一点四十二|01:42)/g, head)) failures.push({ code: "OPENING_PROMISE_LATE", evidence: "fire-before-reset promise is not locatable near the opening" });
  if (has(/(?:系统|面板|任务栏|奖励).{0,16}(?:弹出|提示|显示|到账|增加)/g)) failures.push({ code: "SYSTEM_UI_SHORTCUT", evidence: "system/UI shortcut detected" });
  if (has(/(?:监控|录像).{0,20}(?:自动回放|完整还原|显示了真相)|消防员.{0,15}(?:提前|已经|正好)(?:赶到|等候)/g)) failures.push({ code: "EXTERNAL_PROOF_OR_RESCUE_CHEAT", evidence: "automatic proof or early rescue detected" });
  if (has(/(?:妹妹|姐姐|恋人|女友|妻子).{0,18}(?:困在|还在|冲进).{0,8}(?:火场|仓库)/g, tail)) failures.push({ code: "FAMILY_IN_FIRE_TAIL", evidence: "late family-in-fire hook detected" });
  if (has(/(?:陌生电话|电话突然响|敲门|尸体|奖励到账)/g, tail)) failures.push({ code: "SECOND_HOOK_DEVICE", evidence: "unearned second-hook device detected in tail" });
  if (!has(/十九|19/g)) failures.push({ code: "HEADCOUNT_NOT_CLOSED", evidence: "nineteen-person evacuation is not locatable" });
  if (!has(/鼓包|膨胀|发热|甜腻|漏气/g)) failures.push({ code: "MISSING_OBSERVABLE_ANOMALY", evidence: "observable battery anomaly is absent" });
  if (!has(/梅姐/g) || !has(/高勇/g) || !has(/赵临/g)) failures.push({ code: "MISSING_CAUSAL_ACTOR", evidence: "one or more core actors are absent" });
  if (!has(/(?:插线板|电池).{0,40}(?:门外|推出|保住|证据)|(?:证据).{0,30}(?:没烧|留下|保住)/g)) reviews.push({ code: "EVIDENCE_CUSTODY_UNCLEAR", evidence: "verify that physical evidence survives and its location is closed" });
  if (!has(/不是.{0,16}(?:七号|7号).{0,12}(?:月台|起火点)|(?:七号|7号).{0,30}(?:没有冒|记错|并非|不是)/g, tail)) reviews.push({ code: "MEMORY_BOUNDARY_UNCLEAR", evidence: "verify that the remembered fire location is explicitly disproved" });
  if (has(/(?:化学链式反应|锂离子跃迁|分子级|量子|纳米级).{0,30}(?:燃烧|爆炸|热失控)/g)) reviews.push({ code: "PSEUDO_TECHNICAL_EXPLANATION", evidence: "suspicious technical mechanism language detected" });

  return { source, scope: "T08 deterministic pre-audit only; commercial promise, plausibility and reader pull require blind human review.", metrics: { hanChars, paragraphs: paragraphs.length }, decision: failures.length ? "HARD_FAIL" : reviews.length ? "HUMAN_REVIEW_REQUIRED" : "AUTOMATIC_GATE_PASS_HUMAN_REVIEW_STILL_REQUIRED", failures, reviews };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  const file = process.argv[2];
  const text = file ? fs.readFileSync(file, "utf8") : fs.readFileSync(0, "utf8");
  process.stdout.write(`${JSON.stringify(auditT08(text, file || "stdin"), null, 2)}\n`);
}
