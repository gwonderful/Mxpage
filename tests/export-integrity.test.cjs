// Run with: node --test tests/export-integrity.test.cjs
const { test: nodeTest } = require("node:test");
const test = (name, run) => nodeTest(name, { timeout: 2000 }, run);
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { Writable } = require("node:stream");
const zlib = require("node:zlib");
const ts = require("typescript");

function fixture(count = 10) {
  return {
    id: "export-fixture", name: "Export fixture", modelSnapshot: {},
    assets: [{ id: "upload", type: "MAIN", filePath: "upload.png", fileName: "upload.png", mimeType: "image/png" }],
    sections: Array.from({ length: count }, (_, index) => ({
      id: `section-${index}`, order: index, title: `Section ${index}`, sectionKey: `key-${index}`,
      type: index < 4 ? "HERO" : "SPECS",
      currentImageAsset: { id: `image-${index}`, type: "GENERATED", filePath: `${index}.png`, fileName: `${index}.png`, mimeType: "image/png" },
    })),
  };
}

function loadService(project, unreadable, immediateClose = false) {
  const chunks = [];
  const state = { completed: null, failed: null, readPaths: [], removed: false };
  const exports = {};
  const dependencies = {
    fs: { createWriteStream: () => new Writable({
      autoDestroy: immediateClose,
      write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); },
      final(done) { done(); if (!immediateClose) setImmediate(() => this.emit("close")); },
    }) },
    "fs/promises": { readFile: async () => Buffer.concat(chunks), rm: async () => { state.removed = true; } },
    path, archiver: require("archiver"),
    "@/lib/db/prisma": { prisma: { project: { findUnique: async () => project } } },
    "@/lib/services/task-service": {
      findRecentRunningTask: async () => null, createTask: async () => ({ id: "task-fixture" }),
      completeTask: async (_, result) => { state.completed = result; },
      failTask: async (_, error) => { state.failed = error; },
    },
    "@/lib/storage/asset-manager": { readStorageFile: async (file) => {
      state.readPaths.push(file);
      if (file === unreadable) throw new Error("Fixture storage missing");
      return Buffer.from(`fixture-image:${file}`);
    } },
    "@/lib/utils/content-language": { normalizeContentLanguage: () => "zh-CN", contentLanguageLabels: { "zh-CN": "中文" } },
    "@/lib/utils/files": { extFromMime: () => "png" },
    "@/types/domain": { assetTypeLabels: { MAIN: "上传主图" }, sectionTypeLabels: { specs: "参数" } },
  };
  const source = fs.readFileSync(path.join(__dirname, "../lib/services/export-service.ts"), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText, { exports, require: (name) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`);
    return dependencies[name];
  }, process, Buffer, Error, console });
  return { service: exports, state };
}

// Read the actual ZIP central directory, rather than mocking archive.append.
function entries(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(end >= 0, "archive has ZIP end record");
  let position = buffer.readUInt32LE(end + 16);
  const result = new Map();
  for (let index = 0; index < buffer.readUInt16LE(end + 10); index += 1) {
    assert.equal(buffer.readUInt32LE(position), 0x02014b50);
    const method = buffer.readUInt16LE(position + 10);
    const size = buffer.readUInt32LE(position + 20);
    const nameLength = buffer.readUInt16LE(position + 28);
    const local = buffer.readUInt32LE(position + 42);
    const name = buffer.subarray(position + 46, position + 46 + nameLength).toString();
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const compressed = buffer.subarray(start, start + size);
    result.set(name, method === 8 ? zlib.inflateRawSync(compressed) : compressed);
    position += 46 + nameLength + buffer.readUInt16LE(position + 30) + buffer.readUInt16LE(position + 32);
  }
  return result;
}

test("a 6/10 project rejects a complete export and lists missing modules", async () => {
  const project = fixture();
  for (const section of project.sections.slice(6)) section.currentImageAsset = null;
  const { service, state } = loadService(project);
  await assert.rejects(service.buildImageArchive(project.id), (error) => {
    assert.equal(error.name, "IncompleteExportError");
    assert.equal(error.details.plannedCount, 10);
    assert.equal(error.details.generatedCount, 6);
    assert.equal(error.details.missingSections.length, 4);
    assert.match(error.message, /Section 6/);
    return true;
  });
  assert.equal(state.completed, null);
  assert.deepEqual(state.readPaths, []);
});

test("a complete archive has ten flatten-safe names, correct bytes and a traceable manifest", async () => {
  const project = fixture();
  const { service, state } = loadService(project);
  const archive = entries(await service.buildImageArchive(project.id));
  const images = [...archive.keys()].filter((name) => name.endsWith(".png"));
  assert.equal(images.length, 10);
  assert.equal(new Set(images.map((name) => path.basename(name))).size, 10);
  const manifest = JSON.parse(archive.get("export-manifest.json"));
  assert.equal(manifest.completeness.plannedCount, 10);
  assert.equal(manifest.completeness.generatedCount, 10);
  assert.deepEqual(manifest.completeness.missingSections, []);
  for (const item of [...manifest.gallery, ...manifest.details]) {
    assert.equal(item.source, "generated_section");
    assert.ok(item.sectionId);
    assert.equal(archive.get(item.zipPath).toString(), `fixture-image:${item.originalFileName}`);
  }
  assert.ok(!state.readPaths.includes("upload.png"), "uploaded reference must not pad generated output");
  assert.equal(state.completed.exportedHeroImages, 4);
  assert.equal(state.completed.exportedDetailImages, 6);
  assert.equal(state.removed, true);
});

test("an uploaded current asset is not counted as a generated section", async () => {
  const project = fixture(1);
  project.sections[0].currentImageAsset = project.assets[0];
  const { service } = loadService(project);
  await assert.rejects(service.buildImageArchive(project.id), (error) => error.details.generatedCount === 0);
});

test("an unplanned asset-only export remains available and labels uploaded sources", async () => {
  const project = fixture(0);
  const { service } = loadService(project);
  const archive = entries(await service.buildImageArchive(project.id));
  const manifest = JSON.parse(archive.get("export-manifest.json"));
  assert.equal(manifest.completeness.plannedCount, 0);
  assert.equal(manifest.completeness.generatedCount, 0);
  assert.equal(manifest.gallery[0].source, "uploaded_asset");
  assert.equal(manifest.gallery[0].assetId, "upload");
});

test("a missing stored image fails export instead of reporting success", async () => {
  const project = fixture(1);
  const { service, state } = loadService(project, "0.png");
  await assert.rejects(service.buildImageArchive(project.id), /Fixture storage missing/);
  assert.equal(state.completed, null);
  assert.match(state.failed, /Fixture storage missing/);
});

test("a fast output stream closing during finalize still completes", async () => {
  const project = fixture(1);
  const { service, state } = loadService(project, undefined, true);
  const archive = entries(await service.buildImageArchive(project.id));
  assert.equal(archive.size, 2);
  assert.ok(state.completed);
});

test("the export endpoint returns 409 and structured missing-section details", async () => {
  const project = fixture(2);
  project.sections[0].currentImageAsset = null;
  const { service } = loadService(project);
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, "../app/api/projects/[id]/export/images/route.ts"), "utf8");
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, Response, require: (name) => {
    if (name === "@/lib/services/export-service") return service;
    if (name === "@/lib/utils/route") return {
      fail: (code, message, details, status) => ({ code, message, details, status }),
      handleRouteError: (error) => { throw error; },
    };
    throw new Error(`Unexpected dependency ${name}`);
  } });
  const response = await exports.GET(null, { params: { id: project.id } });
  assert.equal(response.status, 409);
  assert.equal(response.code, "EXPORT_INCOMPLETE");
  assert.equal(response.details.missingSections[0].sectionId, "section-0");
});
