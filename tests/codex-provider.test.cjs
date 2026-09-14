// Run with: node --test tests/codex-provider.test.cjs
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { EventEmitter } = require("node:events");
const { PassThrough, Writable } = require("node:stream");
const childProcess = require("node:child_process");
const ts = require("typescript");

const resolve = Module._resolveFilename;
Module._resolveFilename = function (name, ...args) {
  return resolve.call(this, name.startsWith("@/") ? path.join(__dirname, "..", name.slice(2)) : name, ...args);
};
require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText, file);

let scenario;
const children = [];
childProcess.spawn = () => {
  const child = new EventEmitter();
  children.push(child);
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => { child.killed = true; child.stdout.end(); child.stderr.end(); child.emit("exit", 0); };
  const send = (value) => child.stdout.write(JSON.stringify(value) + "\n");
  child.stdin = new Writable({ write(chunk, _, done) {
    const request = JSON.parse(chunk.toString());
    queueMicrotask(() => scenario(request, send, child));
    done();
  } });
  return child;
};

const { inspectCodex, runCodex, imageResult, isCodexProvider } = require("../lib/ai/codex-app-server.ts");
const { isLocalCodexRequest, runWithProviderCredentials, getRequestProviderCredentials } = require("../lib/services/provider-runtime.ts");
const { CodexAdapter } = require("../lib/ai/adapters/codex.ts");
const { sectionPlanOutputSchema } = require("../lib/ai/schemas/section-plan.ts");
const { productAnalysisOutputSchema } = require("../lib/ai/schemas/product-analysis.ts");
const { buildVisualPromptWithAgent } = require("../lib/services/visual-prompt-agent.ts");

function standard(request, send) {
  const results = {
    initialize: {}, "account/read": { account: { type: "chatgpt", planType: "test" } },
    "modelProvider/capabilities/read": { imageGeneration: true },
    "model/list": { data: [{ model: "test-model", isDefault: true, inputModalities: ["text", "image"] }], nextCursor: null },
    "config/read": { config: { mcp_servers: { external: {} }, plugins: { external: {} } } },
    "thread/start": { thread: { id: "test-thread" } }, "turn/start": {},
  };
  if (request.id !== undefined) send({ id: request.id, result: results[request.method] });
}

test("Codex provider regression suite", async (t) => {
  await t.test("optional visual prompt optimization handles Codex timeout without swallowing quota or cancellation", async () => {
    const input = { provider: { models: [{ modelId: "test", capabilities: { text: true } }] }, mode: "ecommerce_section", title: "Cup", goal: "Show cup", copy: "Blue cup", basePrompt: "Preserve the reference blue cup", aspectRatio: "1:1", operation: "test" };
    const adapter = (message) => ({ generateStructured: async () => { throw new Error(message); } });
    const prompt = await buildVisualPromptWithAgent({ ...input, adapter: adapter("CODEX: 请求超时，请检查账号额度及网络后重试。") });
    assert.match(prompt, /Preserve the reference blue cup/);
    assert.match(prompt, /1:1/);
    for (const message of ["CODEX: quota exhausted", "Task canceled", "CODEX: 请先登录"]) {
      await assert.rejects(buildVisualPromptWithAgent({ ...input, adapter: adapter(message) }), (error) => error.message === message);
    }
  });
  await t.test("structured planning preserves transforms, wrappers, defaults and editable fields", async () => {
    const section = { id: "hero_1", type: "hero", title: "Cup", goal: "Show product", copy: "Blue cup", visualPrompt: "Blue cup on white", editableFields: { headline: "Cup", nested: { count: 2 } } };
    for (const payload of [{ sections: [section] }, [section], { data: { sections: [section] } }, { result: { sections: [section] } }]) {
      scenario = (r, s) => {
        standard(r, s);
        if (r.method === "turn/start") {
          assert.equal(r.params.outputSchema.type, "object");
          assert.equal(r.params.outputSchema.additionalProperties, false);
          assert.equal(r.params.outputSchema.properties.json.type, "string");
          assert.match(r.params.input[0].text, /editableFields/);
          s({ method: "item/completed", params: { threadId: "test-thread", item: { type: "agentMessage", phase: "final_answer", text: JSON.stringify({ json: JSON.stringify(payload) }) } } });
          s({ method: "turn/completed", params: { threadId: "test-thread", turn: { status: "completed" } } });
        }
      };
      const result = await new CodexAdapter().generateStructured({ model: "test", userPrompt: "Plan a cup page", schema: sectionPlanOutputSchema });
      assert.deepEqual(result.parsed.sections, [section]);
      assert.equal(result.parsed.visualStyleGuide, undefined);
      assert.deepEqual(JSON.parse(result.raw), payload);
    }
    const noEditableFields = { ...section }; delete noEditableFields.editableFields;
    scenario = (r, s) => {
      standard(r, s);
      if (r.method === "turn/start") {
        s({ method: "item/completed", params: { threadId: "test-thread", item: { type: "agentMessage", text: JSON.stringify({ json: JSON.stringify({ sections: [noEditableFields] }) }) } } });
        s({ method: "turn/completed", params: { threadId: "test-thread", turn: { status: "completed" } } });
      }
    };
    const result = await new CodexAdapter().generateStructured({ model: "test", userPrompt: "Plan", schema: sectionPlanOutputSchema });
    assert.deepEqual(result.parsed.sections[0].editableFields, {});
    await assert.rejects(new CodexAdapter().generateStructured({ model: "test", userPrompt: "Analyze", schema: productAnalysisOutputSchema }), /productName/);
  });
  await t.test("structured transport still rejects invalid envelopes and malformed business JSON", async () => {
    for (const response of [{ json: 42 }, { json: "not JSON" }, { json: '{"sections":[{}]}' }]) {
      scenario = (r, s) => {
        standard(r, s);
        if (r.method === "turn/start") {
          s({ method: "item/completed", params: { threadId: "test-thread", item: { type: "agentMessage", text: JSON.stringify(response) } } });
          s({ method: "turn/completed", params: { threadId: "test-thread", turn: { status: "completed" } } });
        }
      };
      await assert.rejects(new CodexAdapter().generateStructured({ model: "test", userPrompt: "Plan", schema: sectionPlanOutputSchema }));
    }
  });
  await t.test("recognizes local transport and requires ChatGPT authentication", async () => {
    assert.equal(isCodexProvider("codex://local/"), true);
    assert.equal(isCodexProvider("https://example.com"), false);
    scenario = standard;
    assert.equal((await inspectCodex()).imageGeneration, true);
    scenario = (r, s) => r.method === "account/read"
      ? s({ id: r.id, result: { account: { type: "apiKey" } } }) : standard(r, s);
    await assert.rejects(inspectCodex(), /不接受 API Key/);
    assert.ok(children.every((child) => child.killed));
  });
  await t.test("correlates notifications and disables inherited external integrations", async () => {
    scenario = (r, s) => {
      if (r.method === "thread/start") {
        assert.equal(r.params.config.mcp_servers.external.enabled, false);
        assert.equal(r.params.config.plugins.external.enabled, false);
        assert.equal(r.params.config["features.shell_tool"], false);
        assert.equal(r.params.approvalPolicy, "never");
        assert.equal(r.params.ephemeral, true);
      }
      standard(r, s);
      if (r.method === "turn/start") {
        s({ method: "item/completed", params: { threadId: "unrelated", item: { type: "agentMessage", text: "wrong" } } });
        s({ method: "item/completed", params: { threadId: "test-thread", item: { type: "agentMessage", phase: "final_answer", text: '{"ok":true}' } } });
        s({ method: "turn/completed", params: { threadId: "test-thread", turn: { status: "completed" } } });
      }
    };
    assert.equal((await runCodex({ model: "test-model", prompt: "test" })).text, '{"ok":true}');
  });
  await t.test("timeout and cancellation terminate only the owned process", async () => {
    scenario = standard;
    await assert.rejects(runCodex({ model: "test", prompt: "test", timeoutMs: 20 }), /超时/);
    const controller = new AbortController();
    const pending = runCodex({ model: "test", prompt: "test", signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(pending, /canceled/);
    assert.ok(children.every((child) => child.killed));
    await assert.rejects(runCodex({ model: "test", prompt: "test", signal: controller.signal }), /canceled/);
  });
  await t.test("propagates failed turns and rejects missing or failed native images", async () => {
    scenario = (r, s) => {
      standard(r, s);
      if (r.method === "turn/start") s({ method: "turn/completed", params: { threadId: "test-thread", turn: { status: "failed", error: { message: "quota exhausted" } } } });
    };
    await assert.rejects(runCodex({ model: "test", prompt: "test" }), /CODEX: quota exhausted/);
    assert.throws(() => imageResult([{ type: "agentMessage", text: "image.png" }]), /未返回生成图片/);
    assert.throws(() => imageResult([{ type: "imageGeneration", status: "failed", result: "old" }]), /未返回生成图片/);
    assert.equal(imageResult([{ type: "imageGeneration", status: "completed", result: "native-image" }]).result, "native-image");
    await assert.rejects(new CodexAdapter().editImage({ model: "test", image: "image", mask: "mask", prompt: "test" }), /蒙版/);
  });
  await t.test("rejects remote and cross-origin browser requests; propagates local job context", async () => {
    const request = (headers) => ({ headers: new Headers(headers) });
    assert.equal(isLocalCodexRequest(request({ host: "127.0.0.1:3002", origin: "http://127.0.0.1:3002", "sec-fetch-site": "same-origin" })), true);
    for (const headers of [{}, { host: "example.com" }, { host: "localhost", origin: "https://evil.example" }, { host: "localhost", "sec-fetch-site": "cross-site" }]) {
      assert.equal(isLocalCodexRequest(request(headers)), false);
    }
    await runWithProviderCredentials({ localCodexAllowed: true }, async () => {
      await Promise.resolve();
      assert.equal(getRequestProviderCredentials().localCodexAllowed, true);
    });
    assert.equal(getRequestProviderCredentials().localCodexAllowed, undefined);
  });
});
