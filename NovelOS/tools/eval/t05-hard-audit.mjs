#!/usr/bin/env node

import fs from "node:fs";

export function auditT05(text, source = "stdin") {
  const body = text.replace(/^\s*#{1,6}\s+.*$/gm, "").trim();
  const hanChars = (body.match(/[\u3400-\u9fff]/g) || []).length;
  const paragraphs = body.split(/\r?\n\s*\r?\n/).map((p) => p.trim()).filter(Boolean);
  const tail = paragraphs.slice(-3).join("\n");

  const patterns = {
    systemUi: /(?:系统|面板|任务栏|奖励结算|属性点|提示音).{0,18}(?:弹出|提示|显示|到账|增加|发布)|(?:叮|滴)[！!，,。\s]*(?:系统|检测|任务)/g,
    crowdShock: /全场(?:死寂|哗然|震惊)|鸦雀无声|倒吸一口凉气|众人(?:瞪大|震惊|惊呼)|所有人都(?:愣住|看向)/g,
    selfReview: /(?:自评|创作说明|写作说明|去AI味|以上正文|本章通过|我已完成)/g,
    forbiddenTail: /(?:尸体|死人|广播|喇叭|敲门|敲响|门外响起|门外.{0,12}(?:拍|砸|敲).{0,8}(?:门|玻璃))/g,
    abilityExpansion: /触觉读取|读取码的微结构|共振特征|每一枚码.{0,8}(?:背|记)|指腹下渗出|全息结构.{0,8}(?:渗|长出)/g,
    povLeak: /闻岚没走远|她今天只送|她原以为|她等的就是这个/g,
    namedActors: /顾川|周槐|闻岚/g,
    evidenceObjects: /防伪码|批次|药(?:盒|瓶|片|液)|封签|票据|兑换(?:单|记录)|印刷|喷码|编号/g,
    choiceConsequence: /(?:只能|必须|决定|选择|承认|公开|暴露|代价|扣留|封锁|失去|不能再|从此)/g
  };

  const count = (regex, value = body) => (value.match(regex) || []).length;
  const named = [...new Set(body.match(patterns.namedActors) || [])];
  const evidence = count(patterns.evidenceObjects);
  const choiceConsequence = count(patterns.choiceConsequence);
  const failures = [];
  const reviews = [];

  if (hanChars < 1000 || hanChars > 1400) {
    failures.push({ code: "LENGTH_OUT_OF_RANGE", evidence: `${hanChars} Han characters; required 1000-1400` });
  }
  const systemUi = count(patterns.systemUi);
  if (systemUi) failures.push({ code: "SYSTEM_UI_EXPOSITION", evidence: `${systemUi} system/UI-style exposition hit(s)` });
  const selfReview = count(patterns.selfReview);
  if (selfReview) failures.push({ code: "PROMPT_OR_SELF_REVIEW_ECHO", evidence: `${selfReview} self-review/prompt-echo hit(s)` });
  const forbiddenTail = count(patterns.forbiddenTail, tail);
  if (forbiddenTail) failures.push({ code: "FORBIDDEN_TAIL_DEVICE", evidence: `${forbiddenTail} corpse/broadcast/knock hit(s) in final three paragraphs` });
  const abilityExpansion = count(patterns.abilityExpansion);
  if (abilityExpansion) failures.push({ code: "ABILITY_BOUNDARY_EXPANSION", evidence: `${abilityExpansion} unauthorized tactile/microstructure/resonance mechanism hit(s)` });
  const povLeak = count(patterns.povLeak);
  if (povLeak) failures.push({ code: "LIMITED_POV_LEAK", evidence: `${povLeak} off-camera certainty hit(s)` });
  if (named.length < 3) reviews.push({ code: "ACTOR_CAUSALITY_REVIEW", evidence: `only ${named.length}/3 named actors appear; deletion test requires scene review` });
  if (evidence < 2) reviews.push({ code: "LOCATABLE_EVIDENCE_REVIEW", evidence: `${evidence} concrete medicine/evidence object hit(s)` });
  if (choiceConsequence < 2) reviews.push({ code: "CHOICE_CONSEQUENCE_REVIEW", evidence: `${choiceConsequence} choice/consequence signal hit(s)` });
  const crowdShock = count(patterns.crowdShock);
  if (crowdShock >= 2) reviews.push({ code: "CROWD_SHOCK_LOOP", evidence: `${crowdShock} crowd-shock phrase hit(s)` });

  return {
    source,
    scope: "T05 deterministic pre-audit only; ability limits, causal necessity, emotional truth and prose quality require blind human review.",
    metrics: { hanChars, paragraphs: paragraphs.length, namedActors: named, evidenceObjectHits: evidence, choiceConsequenceHits: choiceConsequence, crowdShockHits: crowdShock, abilityExpansionHits: abilityExpansion, povLeakHits: povLeak },
    decision: failures.length ? "HARD_FAIL" : reviews.length ? "HUMAN_REVIEW_REQUIRED" : "AUTOMATIC_GATE_PASS_HUMAN_REVIEW_STILL_REQUIRED",
    failures,
    reviews
  };
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  const file = process.argv[2];
  const text = file ? fs.readFileSync(file, "utf8") : fs.readFileSync(0, "utf8");
  process.stdout.write(`${JSON.stringify(auditT05(text, file || "stdin"), null, 2)}\n`);
}
