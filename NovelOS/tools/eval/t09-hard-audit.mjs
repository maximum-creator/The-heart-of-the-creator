#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { analyzeNarrativeFingerprints } from "./narrative-fingerprint.mjs";

export function auditT09(text, source = "stdin") {
  const firstLine = text.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) || "";
  const body = text.replace(/^\s*#{1,6}\s+.*$/gmu, "").trim();
  const hanChars = (body.match(/[\u3400-\u9fff]/gu) || []).length;
  const paragraphs = body.split(/\r?\n\s*\r?\n/u).map((item) => item.trim()).filter(Boolean);
  const closing = paragraphs.slice(-12).join("\n");
  const tail = paragraphs.slice(-3).join("\n");
  const fingerprints = analyzeNarrativeFingerprints([{ source, text }]);
  const failures = [];
  const reviews = [];

  if (hanChars < 1300 || hanChars > 1700) failures.push({ code: "LENGTH_OUT_OF_RANGE", evidence: `${hanChars} Han characters; required 1300-1700` });
  if (!/^(?:#{1,6}\s*)?(?:《[^》]{1,24}》|(?:第[\u3400-\u9fff0-9]{1,10}章[ \t]+)?[\u3400-\u9fff0-9：:·]{1,24})$/u.test(firstLine)) failures.push({ code: "MISSING_TITLE", evidence: "first non-empty line appears to be prose" });

  for (const name of ["林彻", "林淼", "老曹"]) if (!body.includes(name)) failures.push({ code: "MISSING_CORE_ACTOR", evidence: name });
  if (!/(?:六百|600).{0,6}元?/u.test(body)) failures.push({ code: "MISSING_SALE_PRICE", evidence: "600 yuan signboard price is not locatable" });
  if (!/(?:二百五十|250).{0,6}(?:二|两).{0,4}(?:份|人)|(?:两|二).{0,5}(?:二百五十|250)|欠薪.{0,12}(?:五百|500)|(?:五百|500).{0,12}(?:分成|分作).{0,4}(?:两|二)份/u.test(body)) reviews.push({ code: "WAGE_CHAIN_REVIEW", evidence: "verify that two 250-yuan wage payments close to 500" });
  if (!/(?:二百六十|两百六十|二百六|两百六|260)(?:元|块)?(?:路费)?|路费.{0,8}(?:二百六十|两百六十|二百六|两百六|260)/u.test(body)) failures.push({ code: "MISSING_TRAVEL_NEED", evidence: "260 yuan travel need is not locatable" });
  if (!/(?:九点十分|9[:：]10)/u.test(body)) failures.push({ code: "MISSING_BUS_DEADLINE", evidence: "9:10 bus deadline is not locatable" });
  if (!/(?:没赶上|赶不上|错过|开走|走了|发车).{0,12}(?:车|班车)|(?:车|班车).{0,12}(?:没赶上|赶不上|错过|开走|走了|发车)|(?:班次|车票).{0,12}停止检票|停止检票.{0,12}(?:班次|车票)|(?:九点十[一二三四五六七八九]|9[:：]1[1-9]).{0,60}(?:车票|班车)|(?:车票|班车).{0,60}(?:九点十[一二三四五六七八九]|9[:：]1[1-9])/u.test(closing)) failures.push({ code: "BUS_OUTCOME_NOT_CLOSED", evidence: "closing passage does not establish that the 9:10 bus is no longer reachable" });
  const signboardRemoved = /(?:取走|搬走|装车|抬走).{0,8}(?:木匾|匾)|(?:木匾|匾).{0,12}(?:取走|搬走|装车|抬走|绑上车|推走|出了门|过门框|真走了|离店)/u.test(body)
    || /(?:木匾|匾)[\s\S]{0,160}(?:放到|装上).{0,10}推车[\s\S]{0,160}(?:搬运工接手|推车.{0,8}远去)/u.test(body);
  if (!signboardRemoved) failures.push({ code: "SIGNBOARD_OUTCOME_NOT_CLOSED", evidence: "buyer removal of the signboard is not locatable" });
  if (/(?:抱在一起|相视一笑|终于理解|终于明白了对方|原谅(?:了)?你|一家人没有隔夜仇|冰释前嫌|和好如初)/u.test(body)) failures.push({ code: "FORCED_RECONCILIATION", evidence: "timely reconciliation shortcut detected" });
  if (/(?:系统|面板|奖励结算|突然来钱|临时加价|多给了|翻倍价|陌生人.{0,8}(?:帮|救|垫钱))/u.test(body)) failures.push({ code: "UNAUTHORIZED_SOLUTION", evidence: "system, sudden money, price increase or rescue detected" });
  if (/(?:短信|电话.{0,6}(?:响|震|打|接)|手机.{0,12}(?:震动|响起|来电|通知))/u.test(body)) failures.push({ code: "FORBIDDEN_COMMUNICATION_DEVICE", evidence: "a phone or message event is used in this closed scenario" });
  if (/(?:一百|100)元?(?:的)?(?:纸币)?.{0,30}撕成两半|纸币.{0,30}撕成两半/u.test(body)) failures.push({ code: "IMPOSSIBLE_CASH_TRANSFORMATION", evidence: "a banknote is physically split as though its denomination changed" });
  if (/(?:创作说明|写作说明|自评|去AI味|本章通过|以上正文)/u.test(body)) failures.push({ code: "SELF_REVIEW_ECHO", evidence: "visible self-review detected" });
  if (/(?:我是正文作者|让我(?:审视|分析|定因果|写草稿|检查)|我(?:先|来)(?:分析|设计|检查)|输出正文，不加自评|字数应达标|最终收尾：)/u.test(body)) failures.push({ code: "VISIBLE_REASONING_LEAK", evidence: "planning or hidden-reasoning language is visible in the delivered message" });
  if (/(?:尸体|广播|敲门|门外响起|电话突然|新事故)/u.test(tail)) failures.push({ code: "CHEAP_TAIL_DEVICE", evidence: "forbidden external tail device in final three paragraphs" });

  const tailSummary = fingerprints.files[0].signals.find((item) => item.code === "TAIL_SUMMARY_OR_THEME");
  if (tailSummary) failures.push({ code: "TAIL_SUMMARY_OR_THEME", evidence: tailSummary.evidence });
  const phraseRepeat = fingerprints.files[0].signals.find((item) => item.code === "INTERNAL_EXACT_PHRASE_REPEAT");
  if (phraseRepeat) reviews.push({ code: "INTERNAL_EXACT_PHRASE_REPEAT", evidence: phraseRepeat.evidence });

  return {
    source,
    scope: "T09/T11/T12 cash-and-agency deterministic gate. Character voice, subtext, deletion test, emotional aftertaste and reader desire still require blind human review.",
    metrics: { hanChars, paragraphs: paragraphs.length, fingerprintSignals: fingerprints.files[0].signals },
    decision: failures.length ? "HARD_FAIL" : reviews.length ? "HUMAN_REVIEW_REQUIRED" : "AUTOMATIC_GATE_PASS_HUMAN_REVIEW_STILL_REQUIRED",
    failures,
    reviews
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const file = process.argv[2];
  const text = file ? fs.readFileSync(file, "utf8") : fs.readFileSync(0, "utf8");
  process.stdout.write(`${JSON.stringify(auditT09(text, file || "stdin"), null, 2)}\n`);
}
