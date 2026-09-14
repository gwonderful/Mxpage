// Run with: node --test tests/workflow-retry-integrity.test.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../lib/services/workflow-task-service.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;

function fixture() {
  const rows = new Map();
  const jobs = [];
  const sections = [0, 1].map(i => ({ id: `section-${i}`, projectId: "project", title: `Cup ${i}`, currentImageAssetId: "old-image" }));
  let nextId = 0;
  let edit = async () => ({ imageAsset: { id: "image" } });
  let generate = async () => ({ generationMode: "image_api" });
  const active = task => task && ["PENDING", "RUNNING"].includes(task.status);
  const tasks = {
    getTask: async id => structuredClone(rows.get(id)),
    createTask: async input => {
      const id = `task-${++nextId}`;
      const row = { sectionId: null, ...input, id, status: input.status || "RUNNING", updatedAt: new Date() };
      rows.set(id, row);
      return structuredClone(row);
    },
    startTask: async (id, patch) => {
      const row = rows.get(id);
      if (active(row)) { row.status = "RUNNING"; row.outputPayload = { ...row.outputPayload, ...patch }; }
      return row;
    },
    updateTaskProgress: async (id, patch) => { const row = rows.get(id); if (active(row)) row.outputPayload = { ...row.outputPayload, ...patch }; return row; },
    cancelTask: async id => { const row = rows.get(id); if (active(row)) row.status = "CANCELED"; return row; },
    assertTaskNotCanceled: async id => { if (!active(rows.get(id))) throw new Error(rows.get(id)?.status === "CANCELED" ? "Task canceled." : "Task stopped."); },
    completeTask: async (id, output) => { const row = rows.get(id); if (active(row)) { row.status = "SUCCESS"; row.outputPayload = output; } },
    failTask: async (id, errorMessage, output) => { const row = rows.get(id); if (active(row)) { row.status = "FAILED"; row.errorMessage = errorMessage; row.outputPayload = output; } },
    recoverStaleBulkGenerationTask: async task => task,
    runTaskInBackground: handler => jobs.push(handler),
  };
  const prisma = {
    pageSection: { findMany: async () => structuredClone(sections) },
    generationTask: {
      findFirst: async () => null,
      updateMany: async ({ where, data }) => {
        const row = rows.get(where.id);
        if (row && where.status.in.includes(row.status)) { Object.assign(row, data); return { count: 1 }; }
        return { count: 0 };
      },
    },
  };
  const dependencies = {
    "@/lib/db/prisma": { prisma },
    "@/lib/services/task-service": tasks,
    "@/lib/services/provider-runtime": { runWithProviderCredentials: (_, fn) => fn() },
    "@/lib/services/generation-service": { editSectionImage: (...args) => edit(...args), generateSectionImage: (...args) => generate(...args), regenerateSectionImage: (...args) => generate(...args) },
    "@/lib/utils/content-language": { normalizeContentLanguage: value => value || "zh-CN" },
  };
  const exports = {};
  vm.runInNewContext(code, { exports, Error, Date, console, process, setInterval, clearInterval,
    require: name => name in dependencies ? dependencies[name] : name.startsWith("@/") ? {} : require(name),
  });
  return { rows, jobs, tasks, workflow: exports, sections, setEdit: fn => { edit = fn; }, setGenerate: fn => { generate = fn; } };
}

for (const taskType of ["BATCH_CREATE", "TRANSLATE_PAGE", "XHS_GENERATE", "GENERATE"]) {
  test(`${taskType}: retry creates a fresh attempt and preserves the terminal record`, async () => {
    const f = fixture();
    const inputPayload = { files: [{ fileName: "cup.png", filePath: "fixture.png" }], plan: { pages: [] }, projectId: "project", targetLanguage: "en-US" };
    const original = await f.tasks.createTask({ projectId: "project", taskType, status: "CANCELED", inputPayload, outputPayload: { completedItems: 1 } });
    const retried = await f.workflow.retryWorkflowTask(original.id, {});
    assert.notEqual(retried.id, original.id);
    assert.equal(retried.inputPayload.retryOfTaskId, original.id);
    assert.deepEqual(await f.tasks.getTask(original.id), original);
    assert.equal(f.jobs.length, 1);
  });
}

test("retry cannot revive the old translation worker after its pending image returns", async () => {
  const f = fixture();
  let enter;
  const entered = new Promise(resolve => { enter = resolve; });
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  let calls = 0;
  f.setEdit(async () => { calls++; if (calls === 1) { enter(); await pending; } return { imageAsset: { id: "image" } }; });
  const original = await f.workflow.createTranslatePageTask({ projectId: "project", targetLanguage: "en-US" }, {});
  const oldWorker = f.jobs[0]();
  await entered;
  await f.tasks.cancelTask(original.id);
  const retried = await f.workflow.retryWorkflowTask(original.id, {});
  release();
  await oldWorker;
  assert.equal(calls, 1, "the canceled attempt must not start the next image");
  assert.equal((await f.tasks.getTask(original.id)).status, "CANCELED");
  assert.equal((await f.tasks.getTask(retried.id)).status, "PENDING");
});

for (const parentStatus of ["FAILED", "CANCELED", "SUCCESS"]) {
  test(`a child registered after parent ${parentStatus} is canceled before its model call`, async () => {
    const f = fixture();
    f.sections.splice(1);
    let calls = 0;
    let child;
    let parent;
    f.setGenerate(async (projectId, sectionId, _model, _refs, onTaskCreated) => {
      child = await f.tasks.createTask({ projectId, sectionId, taskType: "GENERATE" });
      f.rows.get(parent.id).status = parentStatus;
      await onTaskCreated(child.id);
      calls++;
      return { generationMode: "image_api" };
    });
    parent = await f.workflow.createGenerateAllSectionsTask({ projectId: "project" }, {});
    await f.jobs[0]();
    assert.equal(calls, 0);
    assert.equal((await f.tasks.getTask(child.id)).status, "CANCELED");
    assert.equal((await f.tasks.getTask(parent.id)).status, parentStatus);
  });
}
