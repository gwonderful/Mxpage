import assert from "node:assert/strict";
import fs from "node:fs";

const snapshotService = fs.readFileSync("lib/services/project-model-snapshot-service.ts", "utf8");
const projectService = fs.readFileSync("lib/services/project-service.ts", "utf8");
const analysisService = fs.readFileSync("lib/services/analysis-service.ts", "utf8");
const plannerService = fs.readFileSync("lib/services/planner-service.ts", "utf8");
const outputConfigCard = fs.readFileSync("components/shared/project-output-config-card.tsx", "utf8");

assert.doesNotMatch(snapshotService, /json_patch|JSON_MERGE_PATCH|\$executeRaw/);
assert.match(snapshotService, /updatedAt: current\.updatedAt/);
assert.match(snapshotService, /prisma\.project\.updateMany/);
assert.match(snapshotService, /maxSnapshotUpdateAttempts = 5/);
assert.match(snapshotService, /mergeSnapshotValue\(current\.modelSnapshot, snapshotPatch\)/);
assert.match(projectService, /patchProjectModelSnapshot\(projectId, modelSnapshot\)/);
assert.match(analysisService, /patchProjectModelSnapshot\(projectId, \{[\s\S]*analysisModelId: model/);
assert.doesNotMatch(analysisService, /modelSnapshot: \{[\s\S]*analysisModelId: model/);
// Planning now commits preview settings together with sections; it must not
// change configuration before a model/transaction failure. Runtime rollback
// and preservation checks live in planning-integrity.test.cjs.
assert.doesNotMatch(plannerService, /patchProjectModelSnapshot\(projectId, \{ previewConfig \}\)/);
assert.match(plannerService, /savePlannedSections\(task\.id, projectId, sections, \{[\s\S]*?previewConfig,/);
assert.match(plannerService, /modelSnapshot: \{ \.\.\.snapshot, \.\.\.snapshotPatch \}/);
assert.doesNotMatch(outputConfigCard, /\.\.\.snapshot/);
