// Real SQLite, isolated fixtures, and real task/workflow code; no model requests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { DatabaseSync } = require('node:sqlite');
const { PrismaClient } = require('@prisma/client');
const ts = require('typescript');

function load(file, dependencies) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(code, {
    exports: module.exports, module, console, process, Error, AbortController, Date, setInterval, clearInterval,
    require: (id) => id in dependencies ? dependencies[id] : id.startsWith('@/') ? {} : require(id),
  }, { filename: file });
  return module.exports;
}

async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mxpage-task-test-'));
  const file = path.join(dir, 'test.db');
  const db = new DatabaseSync(file);
  for (const entry of fs.readdirSync('prisma/migrations').sort()) {
    const sql = path.join('prisma/migrations', entry, 'migration.sql');
    if (fs.existsSync(sql)) db.exec(fs.readFileSync(sql, 'utf8'));
  }
  db.close();
  const prisma = new PrismaClient({ datasourceUrl: `file:${file.replaceAll('\\', '/')}` });
  t.after(async () => { await prisma.$disconnect(); fs.rmSync(dir, { recursive: true, force: true }); });
  const project = await prisma.project.create({ data: { name: 'Task fixture', platform: 'test', style: 'test' } });
  const tasks = load('lib/services/task-service.ts', { '@/lib/db/prisma': { prisma } });
  const jobs = [];
  let generate = async () => ({ generationMode: 'image_api' });
  const workflow = load('lib/services/workflow-task-service.ts', {
    '@/lib/db/prisma': { prisma },
    '@/lib/services/task-service': { ...tasks, runTaskInBackground: (handler) => { const job = handler(); jobs.push(job); } },
    '@/lib/services/provider-runtime': { runWithProviderCredentials: (_, fn) => fn() },
    '@/lib/services/generation-service': {
      generateSectionImage: (...args) => generate(...args), regenerateSectionImage: (...args) => generate(...args),
    },
  });
  const section = async (i) => prisma.pageSection.create({ data: {
    projectId: project.id, sectionKey: `fixture_${i}`, type: 'HERO', title: `Fixture ${i}`, goal: '', copy: '', visualPrompt: '', order: i,
  } });
  return { prisma, project, tasks, workflow, jobs, section, setGenerate: (fn) => { generate = fn; } };
}

test('a batch with six successes and four failures is not SUCCESS', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 10; i++) await f.section(i);
  let calls = 0;
  f.setGenerate(async () => { if (++calls > 6) throw new Error('Fixture image failed'); return { generationMode: 'image_api' }; });
  const task = await f.workflow.createGenerateAllSectionsTask({ projectId: f.project.id }, {});
  await Promise.all(f.jobs);
  const result = await f.tasks.getTask(task.id);
  assert.equal(result.status, 'FAILED');
  assert.equal(result.outputPayload.completedItems, 6);
  assert.equal(result.outputPayload.failedItems, 4);
});

test('unsupported retry does not change a terminal task', async (t) => {
  const f = await fixture(t);
  const task = await f.tasks.createTask({ projectId: f.project.id, taskType: 'PLAN', status: 'FAILED' });
  await assert.rejects(f.workflow.retryWorkflowTask(task.id, {}), /does not support retry/);
  assert.deepEqual(await f.tasks.getTask(task.id), task);
});

test('concurrent progress patches preserve both fields', async (t) => {
  const f = await fixture(t);
  const task = await f.tasks.createTask({ projectId: f.project.id, taskType: 'PLAN', outputPayload: { completedItems: 0, currentTaskId: 'old-child' } });
  await Promise.all([
    f.tasks.updateTaskProgress(task.id, { completedItems: 1, currentTaskId: 'new-child' }),
    f.tasks.updateTaskProgress(task.id, { heartbeatAt: 'fixture-time' }),
  ]);
  const result = await f.tasks.getTask(task.id);
  assert.equal(result.outputPayload.completedItems, 1);
  assert.equal(result.outputPayload.currentTaskId, 'new-child');
  assert.equal(result.outputPayload.heartbeatAt, 'fixture-time');
});

test('a canceled queued task cannot be restarted by a late worker', async (t) => {
  const f = await fixture(t);
  const task = await f.tasks.createTask({ projectId: f.project.id, taskType: 'PLAN', status: 'PENDING' });
  await f.tasks.cancelTask(task.id);
  await f.tasks.startTask(task.id);
  assert.equal((await f.tasks.getTask(task.id)).status, 'CANCELED');
});

test('concurrent generate and regenerate cannot both own a section', async (t) => {
  const f = await fixture(t);
  const section = await f.section(0);
  const results = await Promise.allSettled(['GENERATE', 'REGENERATE'].map(taskType => f.tasks.createTask({ projectId: f.project.id, sectionId: section.id, taskType })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(await f.prisma.generationTask.count({ where: { sectionId: section.id, status: { in: ['PENDING', 'RUNNING'] } } }), 1);
});

test('account quota failure stops a batch without trying every remaining image', async (t) => {
  const f = await fixture(t);
  for (let i = 0; i < 3; i++) await f.section(i);
  let calls = 0;
  f.setGenerate(async () => { calls++; throw new Error('CODEX: quota exceeded'); });
  const task = await f.workflow.createGenerateAllSectionsTask({ projectId: f.project.id }, {});
  await Promise.all(f.jobs);
  assert.equal(calls, 1);
  assert.equal((await f.tasks.getTask(task.id)).status, 'FAILED');
});

test('all-success batch completes and a retry creates only missing work', async (t) => {
  const f = await fixture(t);
  const completed = await f.section(0);
  const missing = await f.section(1);
  const asset = await f.prisma.productAsset.create({ data: {
    projectId: f.project.id, type: 'GENERATED', filePath: 'fixture.png', fileName: 'fixture.png',
  } });
  await f.prisma.pageSection.update({ where: { id: completed.id }, data: { currentImageAssetId: asset.id } });
  const old = await f.tasks.createTask({ projectId: f.project.id, taskType: 'GENERATE', status: 'FAILED', outputPayload: { completedItems: 1, failedItems: 1 } });
  const generated = [];
  f.setGenerate(async (_, sectionId) => { generated.push(sectionId); return { generationMode: 'image_api' }; });
  const retry = await f.workflow.retryWorkflowTask(old.id, {});
  await Promise.all(f.jobs);
  assert.deepEqual(generated, [missing.id]);
  assert.notEqual(retry.id, old.id);
  assert.equal((await f.tasks.getTask(retry.id)).status, 'SUCCESS');
  assert.deepEqual(await f.tasks.getTask(old.id), old);
});

test('concurrent bulk requests create exactly one active parent', async (t) => {
  const f = await fixture(t);
  await f.section(0);
  let release;
  f.setGenerate(() => new Promise(resolve => { release = () => resolve({ generationMode: 'image_api' }); }));
  const results = await Promise.allSettled([1, 2].map(() => f.workflow.createGenerateAllSectionsTask({ projectId: f.project.id }, {})));
  // Let the started worker settle before closing its isolated database.
  while (!release) await new Promise(resolve => setImmediate(resolve));
  release();
  await Promise.all(f.jobs);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});

test('progress concurrent with completion preserves final payload and terminal state', async (t) => {
  const f = await fixture(t);
  const task = await f.tasks.createTask({ projectId: f.project.id, taskType: 'PLAN' });
  await Promise.all([
    f.tasks.completeTask(task.id, { completedItems: 10 }),
    f.tasks.updateTaskProgress(task.id, { heartbeatAt: 'late-heartbeat' }),
    f.tasks.cancelTask(task.id),
  ]);
  const final = await f.tasks.getTask(task.id);
  assert.ok(['SUCCESS', 'CANCELED'].includes(final.status));
  if (final.status === 'SUCCESS') assert.equal(final.outputPayload.completedItems, 10);
  await f.tasks.updateTaskProgress(task.id, { completedItems: 0 });
  await f.tasks.startTask(task.id);
  assert.deepEqual(await f.tasks.getTask(task.id), final);
});

test('transactional activation cannot commit after cancellation', async (t) => {
  const f = await fixture(t);
  const section = await f.section(0);
  const task = await f.tasks.createTask({ projectId: f.project.id, sectionId: section.id, taskType: 'GENERATE' });
  await f.tasks.cancelTask(task.id);
  await assert.rejects(f.prisma.$transaction(async tx => {
    await f.tasks.assertTaskNotCanceled(task.id, tx);
    await tx.pageSection.update({ where: { id: section.id }, data: { title: 'Must not commit' } });
    await f.tasks.completeTask(task.id, {}, tx);
  }), /Task canceled/);
  assert.equal((await f.prisma.pageSection.findUnique({ where: { id: section.id } })).title, section.title);
});

test('stale recovery rechecks fresh heartbeat instead of overwriting live work', async (t) => {
  const f = await fixture(t);
  const task = await f.tasks.createTask({ projectId: f.project.id, taskType: 'GENERATE', outputPayload: { heartbeatAt: new Date(0).toISOString() } });
  await f.tasks.updateTaskProgress(task.id, { heartbeatAt: new Date().toISOString() });
  const live = await f.tasks.getTask(task.id);
  await f.tasks.recoverStaleBulkGenerationTask(task);
  assert.deepEqual(await f.tasks.getTask(task.id), live);
});

test('restart recovery without heartbeat terminates orphan parent and active child', async (t) => {
  const f = await fixture(t);
  const section = await f.section(0);
  const parent = await f.tasks.createTask({ projectId: f.project.id, taskType: 'GENERATE' });
  const child = await f.tasks.createTask({ projectId: f.project.id, sectionId: section.id, taskType: 'GENERATE' });
  await f.prisma.generationTask.update({ where: { id: parent.id }, data: { outputPayload: { currentTaskId: child.id, completedItems: 0 }, updatedAt: new Date(0) } });
  const result = await f.tasks.getTaskWithStaleRecovery(parent.id);
  assert.equal(result.status, 'FAILED');
  assert.equal((await f.tasks.getTask(child.id)).status, 'FAILED');
  assert.equal((await f.prisma.pageSection.findUnique({ where: { id: section.id } })).status, 'IDLE');
  // Recovery is idempotent and cannot revive an old worker.
  await f.tasks.startTask(parent.id);
  assert.deepEqual(await f.tasks.getTask(parent.id), result);
});

test('orphan single-image ownership can be explicitly canceled and retried without expiry guesses', async (t) => {
  const f = await fixture(t);
  const section = await f.section(0);
  const old = await f.tasks.createTask({ projectId: f.project.id, sectionId: section.id, taskType: 'GENERATE' });
  await f.prisma.generationTask.update({ where: { id: old.id }, data: { startedAt: new Date(0), updatedAt: new Date(0) } });
  await assert.rejects(f.tasks.createTask({ projectId: f.project.id, sectionId: section.id, taskType: 'REGENERATE' }), /终止/);
  await f.tasks.cancelTask(old.id);
  const next = await f.tasks.createTask({ projectId: f.project.id, sectionId: section.id, taskType: 'REGENERATE' });
  assert.notEqual(next.id, old.id);
  assert.equal((await f.tasks.getTask(old.id)).status, 'CANCELED');
});

test('concurrent retries of one old attempt are atomically deduplicated', async (t) => {
  const f = await fixture(t);
  const old = await f.tasks.createTask({ projectId: f.project.id, taskType: 'XHS_GENERATE', status: 'CANCELED' });
  const results = await Promise.allSettled([1, 2].map(() => f.tasks.createTask({
    projectId: f.project.id, taskType: 'XHS_GENERATE', status: 'PENDING', inputPayload: { retryOfTaskId: old.id },
  })));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.deepEqual(await f.tasks.getTask(old.id), old);
});
