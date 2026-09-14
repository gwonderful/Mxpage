// Run with: node --test tests/generation-cancellation.test.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, "../lib/services/generation-service.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(options = {}) {
  const oldImage = { id: "old-image", filePath: "fixture.png", mimeType: "image/png" };
  let state = {
    task: { id: "task", status: "RUNNING" },
    section: { id: "section", projectId: "project", type: "HERO", title: "Cup", goal: "Show cup", copy: "Cup", status: "SUCCESS", currentImageAssetId: oldImage.id, currentImageAsset: oldImage },
    project: { id: "project", assets: [], modelSnapshot: { generationSettings: { allowSvgFallback: true } } },
    versions: [{ id: "old-version", versionNumber: 1, imageAssetId: oldImage.id, isActive: true }],
  };
  let controller;
  const counters = { saves: 0, images: 0, svg: 0, released: 0 };
  const cancel = () => {
    state.task.status = "CANCELED";
    controller?.abort(new Error("Task canceled."));
    if (options.startReplacement) state.replacementRunning = true;
  };
  const prisma = {
    project: {
      findUnique: async () => structuredClone(state.project),
      update: async ({ data }) => { if (options.failProjectUpdate) throw new Error("Fixture database failure"); Object.assign(state.project, data); },
    },
    pageSection: {
      findUnique: async () => structuredClone(state.section),
      update: async ({ data }) => Object.assign(state.section, data),
      updateMany: async ({ where, data }) => {
        if (where.tasks?.none && state.replacementRunning) return { count: 0 };
        Object.assign(state.section, data); return { count: 1 };
      },
    },
    sectionVersion: {
      findFirst: async () => state.versions.at(-1),
      updateMany: async ({ data }) => { state.versions.forEach((v) => Object.assign(v, data)); },
      create: async ({ data }) => { const version = { id: "new-version", ...data }; state.versions.push(version); return version; },
    },
    $transaction: async (run) => {
      if (options.cancelAt === "transaction") cancel();
      const before = structuredClone(state);
      try { return await run(prisma); } catch (error) { state = before; throw error; }
    },
  };
  const assertNotCanceled = async () => { if (state.task.status === "CANCELED") throw new Error("Task canceled."); };
  const image = async ({ signal }) => {
    counters.images++;
    if (options.cancelAt === "image") {
      cancel();
      if (options.abortError) throw Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
    }
    if (options.checkSignal) {
      assert.ok(signal instanceof AbortSignal);
      assert.equal(signal, controller?.signal, "image request must receive task signal");
    }
    return { base64: "fixture", mimeType: "image/png" };
  };
  const deps = {
    zod: require("zod"),
    "@/lib/db/prisma": { prisma },
    "@/lib/ai/prompts": { buildImageEditPrompt: () => "base", buildRegenerationPrompt: () => "base", buildSectionImagePrompt: () => "base", buildSectionSvgLayoutPrompt: () => "svg" },
    "@/lib/services/provider-service": { getProviderAdapter: async () => ({
      provider: { models: [{ modelId: "fixture-image", capabilities: { image_gen: true, image_edit: true, text: true } }] },
      adapter: { generateImage: image, editImage: image, generateText: async () => { counters.svg++; return { text: JSON.stringify({ headline: "Cup", subheadline: "Cup", badge: "Cup", highlights: ["one", "two"], backgroundColor: "#fff", accentColor: "#000", panelColor: "#fff" }) }; } },
    }) },
    "@/lib/services/task-service": {
      createTask: async () => state.task,
      findRecentRunningTask: async () => null,
      registerTaskAbortController: () => { controller = new AbortController(); return controller.signal; },
      releaseTaskAbortController: () => { counters.released++; },
      assertTaskNotCanceled: assertNotCanceled,
      completeTask: async () => {
        await assertNotCanceled();
        if (options.failCompletion) throw new Error("Fixture completion failure");
        state.task.status = "SUCCESS";
      },
      failTask: async () => { if (state.task.status !== "CANCELED") state.task.status = "FAILED"; },
    },
    "@/lib/services/visual-prompt-agent": { buildVisualPromptWithAgent: async ({ signal }) => {
      if (options.cancelAt === "prompt") cancel();
      if (options.checkSignal) assert.equal(signal, controller?.signal, "prompt request must receive task signal");
      return "optimized";
    } },
    "@/lib/storage/asset-manager": { readStorageFile: async () => Buffer.from("fixture"), saveGeneratedImage: async () => {
      counters.saves++;
      if (options.cancelAt === "save") cancel();
      return { id: "new-image" };
    } },
    "@/lib/utils/content-language": { normalizeContentLanguage: () => "zh-CN" },
    "@/lib/utils/visual-style-guide": { readVisualStyleGuide: () => null, buildDefaultVisualStyleGuide: () => ({}) },
    "@/types/domain": { sectionTypeLabels: {} },
  };
  const exports = {};
  vm.runInNewContext(source, { exports, require: (name) => { if (!(name in deps)) throw new Error(`Unexpected dependency: ${name}`); return deps[name]; }, Error, Buffer, console });
  return { run: () => exports[options.mode === "generate" ? "generateSectionImage" : "editSectionImage"]("project", "section"), state: () => state, counters };
}

for (const mode of ["edit", "generate"]) {
  for (const cancelAt of ["prompt", "image", "save", "transaction"]) {
    test(`${mode}: cancellation at ${cancelAt} preserves the old image and active version`, async () => {
      const f = fixture({ mode, cancelAt, abortError: true });
      await assert.rejects(f.run(), /Task canceled/);
      assert.equal(f.state().task.status, "CANCELED");
      assert.equal(f.state().section.currentImageAssetId, "old-image");
      assert.equal(f.state().section.status, "SUCCESS");
      assert.deepEqual(f.state().versions.map((v) => [v.id, v.isActive]), [["old-version", true]]);
      assert.equal(f.counters.svg, 0, "cancellation must not call SVG fallback");
      assert.equal(f.counters.released, 1);
      if (["prompt", "image"].includes(cancelAt)) assert.equal(f.counters.saves, 0);
    });
  }
  test(`${mode}: database failure rolls back version activation and current image together`, async () => {
    const f = fixture({ mode, failProjectUpdate: true });
    await assert.rejects(f.run(), /Fixture database failure/);
    assert.equal(f.state().section.currentImageAssetId, "old-image");
    assert.deepEqual(f.state().versions.map((v) => [v.id, v.isActive]), [["old-version", true]]);
    assert.equal(f.state().task.status, "FAILED");
  });
  test(`${mode}: successful generation shares the abort signal and atomically activates a new version`, async () => {
    const f = fixture({ mode, checkSignal: true });
    const result = await f.run();
    assert.equal(result.imageAsset.id, "new-image");
    assert.equal(f.state().section.currentImageAssetId, "new-image");
    assert.equal(f.state().task.status, "SUCCESS");
    assert.deepEqual(f.state().versions.map((v) => [v.id, v.isActive]), [["old-version", false], ["new-version", true]]);
    assert.equal(f.counters.released, 1);
  });
  test(`${mode}: completion failure rolls back activation`, async () => {
    const f = fixture({ mode, failCompletion: true });
    await assert.rejects(f.run(), /Fixture completion failure/);
    assert.equal(f.state().section.currentImageAssetId, "old-image");
    assert.deepEqual(f.state().versions.map((v) => [v.id, v.isActive]), [["old-version", true]]);
  });
  test(`${mode}: canceled task cleanup does not overwrite a replacement task's generating status`, async () => {
    const f = fixture({ mode, cancelAt: "image", startReplacement: true });
    await assert.rejects(f.run(), /Task canceled/);
    assert.equal(f.state().section.status, "GENERATING");
    assert.equal(f.state().section.currentImageAssetId, "old-image");
  });
}
