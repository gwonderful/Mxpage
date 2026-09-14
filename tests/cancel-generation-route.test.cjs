// Run with: node --test tests/cancel-generation-route.test.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function fixture({ imageId = null, orphan = false, onCancel, onParentRead } = {}) {
  const state = {
    section: { id: "section-fixture", projectId: "project-fixture", currentImageAssetId: imageId, status: "GENERATING" },
    tasks: orphan ? [] : [{ id: "old-task", sectionId: "section-fixture", taskType: "GENERATE", status: "RUNNING" }],
    canceledIds: [],
  };
  const active = (task) => ["PENDING", "RUNNING"].includes(task.status);
  const exports = {};
  const dependencies = {
    "@/lib/db/prisma": { prisma: {
      pageSection: {
        findFirst: async () => ({ ...state.section }),
        update: async ({ data }) => Object.assign(state.section, data),
        updateMany: async ({ where, data }) => {
          if (where.id !== state.section.id || where.projectId !== state.section.projectId) return { count: 0 };
          if (where.currentImageAssetId !== state.section.currentImageAssetId) return { count: 0 };
          assert.deepEqual(Array.from(where.tasks.none.status.in), ["PENDING", "RUNNING"]);
          if (state.tasks.some(active)) return { count: 0 };
          Object.assign(state.section, data);
          return { count: 1 };
        },
      },
      generationTask: { findFirst: async ({ where }) => {
        if (where.sectionId === null) {
          onParentRead?.(state);
          return null;
        }
        return state.tasks.find(active) ?? null;
      } },
    } },
    "@/lib/services/task-service": {
      cancelTask: async (id) => {
        state.canceledIds.push(id);
        const task = state.tasks.find((entry) => entry.id === id);
        task.status = "CANCELED";
        onCancel?.(state);
      },
      updateTaskProgress: async () => {},
    },
    "@/lib/utils/route": {
      ok: (data) => data,
      fail: (code, message) => { throw new Error(`${code}: ${message}`); },
      handleRouteError: (error) => { throw error; },
    },
  };
  const source = fs.readFileSync(path.join(__dirname, "../app/api/projects/[id]/sections/[sectionId]/cancel-generation/route.ts"), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText, { exports, require: (name) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  } });
  const cancel = () => exports.POST(null, { params: { id: state.section.projectId, sectionId: state.section.id } });
  return { state, cancel };
}

test("canceling an old request does not overwrite a newly generated image's SUCCESS status", async () => {
  const { state, cancel } = fixture({ onCancel: (state) => {
    state.section.currentImageAssetId = "new-image";
    state.section.status = "SUCCESS";
  } });
  await cancel();
  assert.equal(state.section.currentImageAssetId, "new-image");
  assert.equal(state.section.status, "SUCCESS");
});

test("a new running task is not reset by a previous cancellation's stale snapshot", async () => {
  const { state, cancel } = fixture({ imageId: "existing-image", onCancel: (state) => {
    state.tasks.push({ id: "new-task", sectionId: state.section.id, taskType: "REGENERATE", status: "RUNNING" });
    state.section.status = "GENERATING";
  } });
  await cancel();
  assert.equal(state.section.status, "GENERATING");
  assert.equal(state.tasks[1].status, "RUNNING");
  assert.deepEqual(state.canceledIds, ["old-task"]);
});

test("a newly pending task also prevents stale orphan-state repair", async () => {
  const { state, cancel } = fixture({ orphan: true, onParentRead: (state) => {
    state.tasks.push({ id: "pending-task", sectionId: state.section.id, taskType: "GENERATE", status: "PENDING" });
  } });
  await cancel();
  assert.equal(state.section.status, "GENERATING");
  assert.deepEqual(state.canceledIds, []);
});

test("an orphaned generating section without a task can still be reset explicitly", async () => {
  for (const imageId of [null, "existing-image"]) {
    const { state, cancel } = fixture({ orphan: true, imageId });
    await cancel();
    assert.equal(state.section.status, imageId ? "SUCCESS" : "IDLE");
  }
});

test("the selected persisted task is canceled even when its worker is no longer running", async () => {
  const { state, cancel } = fixture();
  const response = await cancel();
  assert.equal(response.canceled, true);
  assert.equal(response.taskId, "old-task");
  assert.equal(state.tasks[0].status, "CANCELED");
  assert.equal(state.section.status, "IDLE");
});
