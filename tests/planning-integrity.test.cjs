// Run with: node --test tests/planning-integrity.test.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  return resolve.call(this, name.startsWith("@/") ? path.join(__dirname, "..", name.slice(2)) : name, ...args);
};
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);

let state;
let scenario;
const db = {
  project: {
    findUnique: async () => structuredClone(state.project),
    update: async ({ data }) => {
      if (scenario.failProjectSave) throw new Error("fixture project save failure");
      return Object.assign(state.project, data);
    },
  },
  pageSection: {
    findMany: async () => structuredClone(state.sections),
    findFirst: async () => state.sections.find((s) => s.currentImageAssetId || s.versions?.length || s.status === "RUNNING") ?? null,
    deleteMany: async () => { state.sections = []; },
    createMany: async ({ data }) => {
      if (scenario.failInsert) throw new Error("fixture insert failure");
      state.sections = data.map((s, i) => ({ ...s, id: `new-${i}` }));
    },
  },
  generationTask: { findFirst: async () => scenario.activeGeneration ? { id: "active" } : null },
  $transaction: async (fn) => {
    if (scenario.cancelBeforeTransaction) state.task.status = "CANCELED";
    const before = structuredClone(state);
    try { return await fn(db); } catch (error) { state = before; throw error; }
  },
};
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  if (name === "nanoid") return { nanoid: () => "fixture" };
  if (name === "@/lib/ai/prompts") return { buildSectionPlanningPrompt: () => "fixture prompt" };
  if (name === "@/lib/db/prisma") return { prisma: db };
  if (name === "@/lib/services/project-model-snapshot-service") return {
    patchProjectModelSnapshot: async (_, patch) => Object.assign(state.project.modelSnapshot, patch),
  };
  if (name === "@/lib/services/provider-service") return { getProviderAdapter: async () => ({
    provider: { models: [{ modelId: "fixture", isDefaultPlanning: true, capabilities: { text: true, vision: true } }] },
    adapter: { generateStructured: async () => {
      scenario.modelCalls++;
      if (scenario.beforeResult) scenario.beforeResult();
      if (scenario.modelError) throw new Error(scenario.modelError);
      return { parsed: { sections: [] } };
    } },
  }) };
  if (name === "@/lib/services/task-service") return {
    findRecentRunningTask: async () => null,
    createTask: async () => ({ id: "plan" }),
    registerTaskAbortController: () => new AbortController().signal,
    releaseTaskAbortController: () => {},
    assertTaskNotCanceled: async () => {
      if (state.task.status === "CANCELED") throw new Error("Task canceled.");
    },
    completeTask: async (_, output) => {
      if (scenario.failComplete) throw new Error("fixture task completion failure");
      if (state.task.status === "CANCELED") throw new Error("Task canceled.");
      state.task = { status: "SUCCESS", output };
    },
    failTask: async () => {},
  };
  if (name === "@/lib/storage/asset-manager") return {};
  return originalLoad.call(this, name, ...args);
};
const { planSections } = require("../lib/services/planner-service.ts");

function setup(overrides = {}) {
  scenario = { modelCalls: 0, ...overrides };
  state = {
    task: { status: "RUNNING" },
    project: { id: "fixture", name: "Cup", style: "clean", platform: "mobile", status: "ANALYZED", assets: [],
      modelSnapshot: { keep: "existing", previewConfig: { heroImageCount: 1, detailSectionCount: 1, imageAspectRatio: "9:16", contentLanguage: "zh-CN" } },
      analysis: { normalizedResult: { productName: "Cup", generationRequirements: "  多角度\r\n展示商品  " } } },
    sections: [{ id: "old", visualPrompt: "old prompt", versions: [] }],
  };
}

test("replanning preserves existing images and versions without a model call", async () => {
  for (const protectedData of [{ currentImageAssetId: "image" }, { versions: [{ id: "history" }] }]) {
    setup();
    Object.assign(state.sections[0], protectedData);
    await assert.rejects(planSections("fixture"), /已有生成图片或历史版本/);
    assert.equal(scenario.modelCalls, 0);
    assert.equal(state.sections[0].id, "old");
  }
});

test("failed inserts roll back old sections, status and model snapshot for normal and fallback planning", async () => {
  for (const modelError of [undefined, "Provider request timed out"]) {
    setup({ failInsert: true, modelError });
    const before = structuredClone(state);
    await assert.rejects(planSections("fixture", { previewConfig: { heroImageCount: 2, detailSectionCount: 2, imageAspectRatio: "3:4", contentLanguage: "en-US" } }));
    assert.deepEqual(state, before);
  }
});

test("a new image arriving during planning is protected at commit", async () => {
  setup({ beforeResult: () => { state.sections[0].currentImageAssetId = "late-image"; } });
  await assert.rejects(planSections("fixture"), /已有生成图片或历史版本/);
  assert.equal(state.sections[0].currentImageAssetId, "late-image");
});

test("active generation blocks planning before the model request", async () => {
  setup({ activeGeneration: true });
  await assert.rejects(planSections("fixture"), /仍有生成任务/);
  assert.equal(scenario.modelCalls, 0);
  assert.equal(state.sections[0].id, "old");
});

test("project snapshot failure rolls back inserted sections as well", async () => {
  setup({ failProjectSave: true });
  const before = structuredClone(state);
  await assert.rejects(planSections("fixture"), /fixture project save failure/);
  assert.deepEqual(state, before);
});

test("cancellation immediately before the save transaction preserves the old plan", async () => {
  for (const modelError of [undefined, "Provider request timed out"]) {
    setup({ cancelBeforeTransaction: true, modelError });
    const before = structuredClone(state);
    await assert.rejects(planSections("fixture"), /Task canceled/);
    assert.deepEqual(state.project, before.project);
    assert.deepEqual(state.sections, before.sections);
    assert.equal(state.task.status, "CANCELED");
  }
});

test("task completion and the new plan commit atomically", async () => {
  for (const modelError of [undefined, "Provider request timed out"]) {
    setup({ failComplete: true, modelError });
    const before = structuredClone(state);
    await assert.rejects(planSections("fixture"), /fixture task completion failure/);
    assert.deepEqual(state, before);
  }
});

test("template fallback reports late-arriving protected results without destroying them", async () => {
  setup({ modelError: "Provider request timed out", beforeResult: () => { state.sections[0].currentImageAssetId = "late-image"; } });
  await assert.rejects(planSections("fixture"), /已有生成图片或历史版本/);
  assert.equal(state.sections[0].currentImageAssetId, "late-image");
});

test("planning records the normalized input requirements, including template fallback", async () => {
  for (const modelError of [undefined, "Provider request timed out"]) {
    setup({ modelError });
    await planSections("fixture");
    assert.equal(state.project.modelSnapshot.plannedGenerationRequirements, "多角度\n展示商品");
    assert.equal(state.project.modelSnapshot.keep, "existing");
    assert.equal(state.project.status, "PLANNED");
    assert.equal(state.sections.length, 2);
  }
});

test("requirements sync compares recorded input exactly and treats legacy records as unknown", () => {
  const { getPlanningRequirementsSync } = require("../lib/utils/planning-integrity.ts");
  assert.equal(getPlanningRequirementsSync({}, "多角度", true), "unknown");
  assert.equal(getPlanningRequirementsSync({ plannedGenerationRequirements: "旧要求 生图补充要求" }, "新要求", true), "outdated");
  assert.equal(getPlanningRequirementsSync({ plannedGenerationRequirements: " 多角度\r\n展示 " }, "多角度\n展示", true), "synced");
  assert.equal(getPlanningRequirementsSync({ plannedGenerationRequirements: "多角度" }, "", true), "outdated");
  assert.equal(getPlanningRequirementsSync({}, "", false), "unplanned");
});
