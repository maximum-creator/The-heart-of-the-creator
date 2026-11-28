import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildPro, loadProBindings, validateProRoutes } from '../scripts/build-novelos-pro.mjs';
import { applyEdit, checkDelivery, checkPacket, lockIssue } from '../NovelOS/tools/pro/workflow.mjs';

const source = fileURLToPath(new URL('../pro/', import.meta.url));
const fixture = JSON.parse(fs.readFileSync(path.join(source, 'scene-packet.example.json'), 'utf8'));
const quote = '她心里十分为难。';
const prose = '第一章 鞋摊\n\n她把钥匙搁在鞋盒上。\n\n' + quote + '\n\n来领鞋的人转身走了。';
const raw = prose + '\n[NOVELOS END]\n';

test('scene handoff validates the writer input and rejects unbounded context', () => {
  assert.equal(checkPacket(fixture).decision, 'PACKET_READY');
  assert.equal(checkPacket({ ...fixture, choiceAndCost: '' }).decision, 'BLOCK_PACKET');
  assert.equal(checkPacket({ ...fixture, previousTail: '字'.repeat(601), report: 'hidden' }).decision, 'BLOCK_PACKET');
});

test('delivery distinguishes stoppage, missing receipt, unclosed prose and leaked commentary', () => {
  assert.equal(checkDelivery({ raw, finishReason: 'length' }).decision, 'INCOMPLETE_RAW');
  assert.equal(checkDelivery({ raw, finishReason: 'max_tokens' }).decision, 'INCOMPLETE_RAW');
  assert.equal(checkDelivery({ raw }).decision, 'REVIEW_WITHOUT_STOP_RECEIPT');
  assert.equal(checkDelivery({ raw: prose, finishReason: 'stop' }).decision, 'INCOMPLETE_RAW');
  assert.equal(checkDelivery({ raw: raw.replace(quote, '以下是正文。'), finishReason: 'stop' }).decision, 'BLOCK_DELIVERY');
  assert.equal(checkDelivery({ raw: '第一章 鞋摊\n\n她正要说，\n[NOVELOS END]', finishReason: 'stop' }).decision, 'BLOCK_DELIVERY');
});

test('structural failures stay upstream and local revisions preserve every byte outside the exact quote', () => {
  const packet = checkDelivery({ raw, finishReason: 'end_turn' });
  const issue = { prose, proseSha256: packet.proseSha256, quote, reason: '动作已经交代犹豫，重复解释使下一句失效。' };
  assert.equal(lockIssue({ ...issue, kind: 'STRUCTURAL' }).decision, 'RETURN_TO_ARCHITECT');
  const { order } = lockIssue({ ...issue, kind: 'LOCAL' });
  const edit = applyEdit({ prose, order, replacement: '她的手还在鞋盒上。' });
  assert.equal(edit.revised, prose.replace(quote, '她的手还在鞋盒上。'));
  assert.throws(() => applyEdit({ prose: prose + '旧', order, replacement: '' }), /hash mismatch/);
  assert.throws(() => applyEdit({ prose, order, replacement: '新\n开头' }), /one changed local/);
  assert.throws(() => lockIssue({ ...issue, kind: 'LOCAL', quote: '不存在的句子。' }), /exactly once/);
});

test('Pro package has exact routing, embedded writer rules and a runnable MCP over stdio', (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'novelos-pro-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const root = buildPro(path.join(temp, 'project'));
  assert.throws(() => buildPro(root), /EEXIST/);
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const manifest = JSON.parse(read('model-routes.json'));
  const bindings = loadProBindings(path.join(root, '.feelfish'), manifest.roles);
  assert.equal(new Set([...bindings.values()].flatMap(({ skills }) => skills)).size, 10);
  assert.deepEqual(bindings.get('novelos-pro-director').skills, ['pro-directing', 'pro-series-planning']);
  assert.deepEqual(bindings.get('novelos-pro-dramaturg').skills, ['pro-scene']);
  assert.match(read('.feelfish/agents/novelos-pro-operator.md'), /实际捕获回执由本地操作者登记/);
  assert.match(read('MARKETPLACE.md'), /单独配置本地 Pro MCP/);
  const active = JSON.parse(read('.feelfish/solution.json'));
  const solution = JSON.parse(read('.feelfish/solutions/feelfish-custom.json'));
  assert.equal(solution.primaryAgentId, 'novelos-pro-director');
  assert.equal(solution.agents.length, 10);
  assert.deepEqual(active.agentModels['novelos-pro-opus'], manifest.roles['novelos-pro-opus'].model);
  for (const [role, expected] of Object.entries({
    director: 'feelfish/gpt-6.2-sol',
    continuity: 'feelfish/gpt-6.2-sol',
    arbiter: 'feelfish/gpt-6.2-astra',
    opus: 'feelfish/claude-opus-5-5',
    gemini: 'feelfish/gemini-4-carbon',
    reader: 'anthropic/claude-sonnet-5.5',
  })) {
    const id = 'novelos-pro-' + role;
    assert.equal(active.agentModels[id].modelName, expected);
    assert.deepEqual(solution.agents.find((agent) => agent.id === id).recommendedModel, active.agentModels[id]);
  }
  assert.match(read('templates/longform-handoff.md'), /唯一|两章离线应验例/);
  assert.match(read('.feelfish/agents/novelos-pro-continuity.md'), /pro-continuity/);
  assert.match(read('.feelfish/agents/novelos-pro-curator.md'), /pro-canon/);
  const opus = read('.feelfish/agents/novelos-pro-opus.md');
  assert.match(opus, /^tools: \[\]$/m);
  assert.match(opus, /分别|各自列出代价/);
  assert.equal(opus.match(/^---$/gm).length, 2);
  const carbon = read('.feelfish/agents/novelos-pro-gemini.md');
  assert.match(carbon, /^tools: \[\]$/m);
  assert.match(carbon, /从一件已经开始/);
  assert.match(read('.feelfish/agents/novelos-pro-operator.md'), /novelos_pro_plan_chapter/);
  const mutated = structuredClone(manifest.roles);
  mutated['novelos-pro-opus'].model.temperature = 0.8;
  assert.throws(() => validateProRoutes(mutated), /sampling defaults/);
  const rpc = [
    { id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { id: 2, method: 'tools/list' },
    { id: 3, method: 'tools/call', params: { name: 'novelos_pro_check_packet', arguments: { packet: fixture } } },
    { id: 4, method: 'tools/call', params: { name: 'novelos_pro_apply_edit', arguments: { prose } } },
    { id: 5, method: 'tools/call', params: { name: 'novelos_pro_plan_chapter',
      arguments: { bookId: 'test-book', chapter: 1, parentVersion: 'GENESIS', requiredFactKeys: [], risks: ['volume_end'] } } },
    { id: 6, method: 'tools/call', params: { name: 'novelos_pro_review_impact', arguments: {
      bookId: 'test-book', sourceChapter: 1, sourceFinalSha256: 'a'.repeat(64), headVersion: 'b'.repeat(64),
      changedFactKeys: [], previousTailChanged: false,
    } } },
    { id: 7, method: 'tools/call', params: { name: 'novelos_pro_prepare_chapter', arguments: {
      bookId: 'test-book', chapter: 1, parentVersion: 'GENESIS',
      brief: Object.fromEntries(Object.entries(fixture).filter(([key]) => key !== 'hardFacts')), factKeys: [], dueDecisions: [],
    } } },
    { id: 8, method: 'tools/call', params: { name: 'novelos_pro_evaluate_work',
      arguments: { format: 'COMIC_DRAMA', story: {}, unit: {} } } },
  ];
  const vault = path.join(temp, 'vault');
  fs.mkdirSync(vault);
  const run = spawnSync(process.execPath, [path.join(root, 'NovelOS/tools/pro/mcp.mjs')], {
    env: { ...process.env, NOVELOS_PRO_VAULT: vault },
    encoding: 'utf8', input: 'null\n' + rpc.map((x) => JSON.stringify({ jsonrpc: '2.0', ...x })).join('\n') + '\n'
  });
  assert.equal(run.status, 0, run.stderr);
  const [invalid, init, list, resp, bad, routed, impact, prepared, work] = run.stdout.trim().split('\n').map(JSON.parse);
  assert.equal(invalid.error.code, -32600);
  assert.equal(init.result.serverInfo.version, '1.10.0');
  assert.equal(list.result.tools.length, 11);
  assert.deepEqual(bindings.get('novelos-pro-operator').tools,
    list.result.tools.map((tool) => tool.name));
  assert.ok(list.result.tools.some((tool) => tool.name === 'novelos_pro_review_impact'));
  assert.equal(JSON.parse(resp.result.content[0].text).decision, 'PACKET_READY');
  assert.equal(bad.result.isError, true);
  const plan = JSON.parse(routed.result.content[0].text);
  assert.equal(plan.mode, 'DEEP');
  assert.equal(plan.dispatch.beforeDraft[0], 'novelos-pro-arbiter');
  assert.equal(plan.dispatch.writer, 'novelos-pro-gemini');
  assert.equal(JSON.parse(impact.result.content[0].text).decision, 'STALE_BASELINE');
  assert.equal(JSON.parse(prepared.result.content[0].text).decision, 'READY_TO_WRITE');
  assert.equal(JSON.parse(work.result.content[0].text).decision, 'RETURN_TO_DEVELOPMENT');
  assert.deepEqual(fs.readdirSync(vault), []);

  const canon = path.join(root, 'NovelOS/tools/pro/canon.mjs');
  const candidate = path.join(root, 'canon-candidate.example.json');
  const quality = path.join(root, 'quality-review.example.json');
  const cli = (...args) => spawnSync(process.execPath, [canon, ...args], { encoding: 'utf8' });
  assert.match(cli('stage', vault, candidate).stderr, /QUALITY_REPORT_MISSING/);
  assert.equal(JSON.parse(cli('audit', vault, candidate, quality).stdout).decision, 'QUALITY_REVIEW_SAVED');
  assert.equal(JSON.parse(cli('stage', vault, candidate).stdout).decision, 'CANDIDATE_STAGED');
  const review = JSON.parse(cli('review', vault, 'example-book', 'chapter-01-a').stdout);
  assert.equal(review.decision, 'AUTHOR_REVIEW_REQUIRED');
  assert.equal(review.proof.quality.stateChanges[0].key, 'knowledge:伙计.钥匙位置');
  assert.equal(review.proof.quality.stateChanges[0].line, 3);
  const archived = JSON.parse(cli('rework-save', vault, candidate).stdout);
  assert.equal(archived.decision, 'REWORK_VERSION_SAVED');
  const history = JSON.parse(cli('rework-history', vault, 'example-book', 'chapter-01-a').stdout);
  assert.equal(history.versions.length, 1);
  assert.equal(history.decisionHistoryHead.eventSha256, archived.eventSha256);
  const selection = path.join(temp, 'select.json');
  fs.writeFileSync(selection, JSON.stringify({ bookId: 'example-book', runId: 'chapter-01-a',
    candidateSha256: archived.candidateSha256, expectedEventSha256: archived.eventSha256, authorRef: 'packaged CLI fixture' }));
  const chosen = JSON.parse(cli('rework-select', vault, selection).stdout);
  const approved = cli('approve', vault, 'example-book', 'chapter-01-a', archived.candidateSha256,
    'packaged CLI fixture', '--selection=' + chosen.selectionSha256, '--manual-delivery-reviewed');
  assert.equal(JSON.parse(approved.stdout).decision, 'CANON_APPROVED');
});
