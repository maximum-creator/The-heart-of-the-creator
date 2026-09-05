import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProseCandidate } from '../NovelOS/tools/eval/prose-candidate-gate.mjs';
import { analyzeProseCadence } from '../NovelOS/tools/eval/prose-cadence.mjs';
const policy={version:1,metric:'han',min:2,max:2,enforcement:'review',approved:true};
const evaluate=(draftText,lengthPolicy)=>evaluateProseCandidate({draftText,lengthPolicy,run:{},maxCredits:10});
test('single extreme paragraph is a located review signal, never an automatic edit',()=>{
  const text='甲'.repeat(501);
  const report=analyzeProseCadence(text);
  assert.ok(report.signals.some(s=>s.code==='SINGLE_PARAGRAPH_WALL'&&s.paragraph===1));
  assert.equal(report.decision,'REVIEW_REQUIRED');
});
test('length excludes title and whitespace, counts unicode Han and visible characters distinctly',()=>{
  const result=evaluate('\uFEFF# 第一章 开始\r\n甲𠀀，A1😀 \r\n',policy);
  assert.equal(result.checks.chapterLength.counts.han,2);
  assert.equal(result.checks.chapterLength.counts.visible,6);
  assert.equal(result.checks.chapterLength.decision,'PASS');
});
test('missing target cannot be reported as a length pass',()=>{
  const result=evaluate('开始\n甲乙');
  assert.equal(result.checks.chapterLength.decision,'NOT_CONFIGURED');
  assert.ok(result.reviews.some(s=>s.code==='CHAPTER_LENGTH_NOT_CONFIGURED'));
});
test('targets respect inclusive boundaries, malformed policy and strict failure',()=>{
  for(const text of ['甲','甲乙丙']){
    const result=evaluate('开始\n'+text,policy);
    assert.ok(result.reviews.some(s=>s.code==='CHAPTER_LENGTH_OUT_OF_RANGE'));
  }
  assert.ok(evaluate('开始\n甲',{...policy,enforcement:'reject'}).failures.some(s=>s.code==='CHAPTER_LENGTH_OUT_OF_RANGE'));
  for(const change of [{min:3,max:2},{min:'2'},{metric:'tokens'},{approved:'true'},{enforcement:'ignore'},{max:Infinity},{version:2}]){
    assert.ok(evaluate('开始\n甲乙',{...policy,...change}).failures.some(s=>s.code==='INVALID_CHAPTER_LENGTH_POLICY'));
  }
});
