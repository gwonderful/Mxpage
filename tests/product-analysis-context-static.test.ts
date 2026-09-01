import assert from "node:assert/strict";
import fs from "node:fs";

const quickStart = fs.readFileSync("components/projects/quick-start-workspace.tsx", "utf8");
const analysisWorkspace = fs.readFileSync("components/analysis/analysis-workspace.tsx", "utf8");
const analysisService = fs.readFileSync("lib/services/analysis-service.ts", "utf8");
const analysisPrompt = fs.readFileSync("lib/ai/prompts/analysis.ts", "utf8");

assert.doesNotMatch(quickStart, /\/projects\/\$\{projectId\}\/analyze/);
assert.match(quickStart, /analysis\?source=quick-start/);
assert.match(quickStart, /上传并继续/);
assert.match(analysisWorkspace, /await persistProjectMeta\(\);[\s\S]*\/api\/projects\/\$\{project\.id\}\/analyze/);
assert.match(analysisWorkspace, /商品补充信息（会参与 AI 识别）/);
assert.match(analysisService, /name: project\.name/);
assert.match(analysisService, /description: project\.description/);
assert.match(analysisPrompt, /User-provided product context/);
