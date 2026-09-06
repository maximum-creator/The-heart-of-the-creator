import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkMarketplace } from '../scripts/check-marketplace.mjs';
const source=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../marketplace/feelfish');
for (const [label,link,exists,expected] of [
  ['bundled attachment','assets/local.md',true,'PASS'],
  ['missing attachment','assets/absent.md',false,'MISSING_ATTACHMENT'],
  ['escape from skill','assets/../../outside.md',false,'UNSAFE_ATTACHMENT'],
  ['encoded escape','assets/%2e%2e/%2e%2e/outside.md',false,'UNSAFE_ATTACHMENT'],
]) test(label,()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'novelos-attachment-'));
  try {
    fs.cpSync(source,root,{recursive:true});
    const skill=path.join(root,'.feelfish/skills/novelos-state-learning');
    if(exists){fs.mkdirSync(path.join(skill,'assets'),{recursive:true});fs.writeFileSync(path.join(skill,link),'# Local template\n');}
    fs.appendFileSync(path.join(skill,'SKILL.md'),`\n按需读取 [模板](${link})。\n`);
    const result=checkMarketplace(root);
    if(expected==='PASS')assert.equal(result.decision,'PASS',JSON.stringify(result.failures));
    else assert.ok(result.failures.some(f=>f.code===expected),JSON.stringify(result.failures));
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
test('market package is self-contained and model bindings agree',()=>assert.equal(checkMarketplace(source).decision,'PASS'));
test('missing resources, old script dependency and invalid model are detected',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'novelos-market-'));
  try {
    fs.cpSync(source,root,{recursive:true});
    fs.appendFileSync(path.join(root,'.feelfish/agents/novelos-narrative-editor.md'),'\n先运行 NovelOS/tools/eval/narrative-fingerprint.mjs\n');
    fs.unlinkSync(path.join(root,'.feelfish/skills/novelos-cross-chapter-variation/SKILL.md'));
    const file=path.join(root,'.feelfish/solutions/feelfish-custom.json');
    const config=JSON.parse(fs.readFileSync(file,'utf8'));
    config.agents.find(a=>a.id==='novelos-director').recommendedModel.temperature=0.25;
    fs.writeFileSync(file,JSON.stringify(config));
    const codes=checkMarketplace(root).failures.map(f=>f.code);
    for(const code of ['EXTERNAL_DEPENDENCY','UNSUPPORTED_TEMPERATURE','MODEL_DRIFT','PACKAGE_READ_ERROR'])assert.ok(codes.includes(code),code);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
