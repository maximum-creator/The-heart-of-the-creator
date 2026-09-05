import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkModelParameters } from '../NovelOS/tools/config/model-parameter-policy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export function checkMarketplace(root = path.resolve(here, '../marketplace/feelfish')) {
  const failures = [];
  const check = (ok, code, file) => { if (!ok) failures.push({code,file}); };
  const read = rel => fs.readFileSync(path.join(root,rel),'utf8').replace(/\r\n?/g,'\n');
  const walk = dir => fs.readdirSync(dir,{withFileTypes:true}).flatMap(e => {
    const p = path.join(dir,e.name);
    if(e.isSymbolicLink()) { failures.push({code:'SYMLINK_NOT_ALLOWED',file:p}); return []; }
    return e.isDirectory()?walk(p):[p];
  });
  try {
    for (const file of walk(root)) {
      const rel=path.relative(root,file).replaceAll('\\','/');
      check(/\.(md|json)$/.test(rel)||rel==='LICENSE','UNSUPPORTED_FILE',rel);
      check(!/memory\/|\.bak$|mcp-config|market_resources/.test(rel),'PRIVATE_OR_LOCAL_FILE',rel);
      if(rel.startsWith('.feelfish/agents/')||rel.endsWith('/SKILL.md')) {
        const text=read(rel);
        check(!/NovelOS\/|\.mjs\b|references\/|assets\/|\.feelfish\//i.test(text),'EXTERNAL_DEPENDENCY',rel);
        check(!/https?:\/\//i.test(text),'REMOTE_PROMPT_DEPENDENCY',rel);
        check(/^---\nname: [^\n]+\ndescription:[\s\S]+?\n---\n/.test(text),'INVALID_FRONTMATTER',rel);
      }
    }
    const solution=JSON.parse(read('.feelfish/solutions/feelfish-custom.json'));
    const active=JSON.parse(read('.feelfish/solution.json'));
    const ids=solution.agents.map(a=>a.id);
    check(ids.length===11&&new Set(ids).size===11,'AGENT_COUNT_OR_DUPLICATE','solution');
    check(ids.includes(solution.primaryAgentId),'MISSING_PRIMARY','solution');
    check(active.currentSolutionId==='feelfish-custom','ACTIVE_SOLUTION','solution');
    const skills=fs.readdirSync(path.join(root,'.feelfish/skills'));
    check(skills.length===16,'SKILL_COUNT','skills');
    const bound=new Set();
    for(const a of solution.agents) {
      const file=`.feelfish/agents/${a.id}.md`;
      const text=read(file);
      const front=text.split('\n---\n')[0];
      const refs=(front.match(/\nskills:\n([\s\S]*)$/)||[])[1]||'';
      const agentSkills=[...refs.matchAll(/^  - ([a-z0-9-]+)$/gm)].map(m=>m[1]);
      check(agentSkills.length>0&&agentSkills.length<=2,'SKILL_BINDING_LIMIT',file);
      for(const id of agentSkills){bound.add(id);check(skills.includes(id),'MISSING_SKILL',id);}
      check(!/^  - novelos_/m.test(front),'CUSTOM_TOOL_REQUIRED',file);
      if(a.id==='novelos-prose-writer')check(/\ntools: \[\]\n/.test(front),'WRITER_TOOLS',file);
      for(const code of checkModelParameters(a.recommendedModel))failures.push({code,file});
      check(JSON.stringify(a.recommendedModel)===JSON.stringify(active.agentModels[a.id]),'MODEL_DRIFT',file);
    }
    for(const id of skills) {
      check(bound.has(id),'UNBOUND_SKILL',id);
      const text=read(`.feelfish/skills/${id}/SKILL.md`);
      check(text.startsWith(`---\nname: ${id}\n`),'SKILL_ID_MISMATCH',id);
    }
  } catch(error){failures.push({code:'PACKAGE_READ_ERROR',message:error.message});}
  return {decision:failures.length?'FAIL':'PASS',failures};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=checkMarketplace(process.argv[2]);
  console.log(JSON.stringify(result,null,2));
  if(result.decision!=='PASS')process.exitCode=1;
}
