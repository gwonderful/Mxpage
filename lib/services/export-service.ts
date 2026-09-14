import fs from "fs";
import fsp from "fs/promises";
import path from "path";

import archiver from "archiver";

import { prisma } from "@/lib/db/prisma";
import { completeTask, createTask, failTask, findRecentRunningTask } from "@/lib/services/task-service";
import { readStorageFile } from "@/lib/storage/asset-manager";
import { contentLanguageLabels, normalizeContentLanguage } from "@/lib/utils/content-language";
import { extFromMime } from "@/lib/utils/files";
import { assetTypeLabels, sectionTypeLabels } from "@/types/domain";

function getPreviewConfig(project: { modelSnapshot: unknown } | null) {
  const snapshot = (project?.modelSnapshot as Record<string, unknown> | null) ?? {};
  const config = (snapshot.previewConfig as Record<string, unknown> | null) ?? {};

  return {
    heroImageCount: Math.min(5, Math.max(1, Number(config.heroImageCount ?? 4))),
    detailSectionCount: Math.min(10, Math.max(1, Number(config.detailSectionCount ?? 6))),
    imageAspectRatio: config.imageAspectRatio === "3:4" ? "3:4" : "9:16",
    contentLanguage: normalizeContentLanguage(config.contentLanguage),
  };
}

function buildGalleryAssets(project: {
  assets: any[];
  sections: Array<{ id: string; title: string; type: string; currentImageAsset: any | null; versions?: any[] }>;
  modelSnapshot: unknown;
}) {
  const previewConfig = getPreviewConfig(project);
  // Reference uploads are exportable only when there is no generated-page plan.
  const uploadedAssets = project.sections.length ? [] : project.assets.filter((asset) => ["MAIN", "ANGLE"].includes(asset.type));
  const heroSectionAssets = project.sections
    .filter((section) => section.type === "HERO" && section.currentImageAsset)
    .map((section, index) => ({
      asset: section.currentImageAsset,
      title: section.title || `头图 ${index + 1}`,
      sourceLabel: "头图规划",
      source: "generated_section",
      sectionId: section.id,
    }));

  const merged = [
    ...heroSectionAssets,
    ...uploadedAssets.map((asset) => ({
      asset,
      title: asset.fileName,
      sourceLabel: assetTypeLabels[asset.type as keyof typeof assetTypeLabels] ?? asset.type,
      source: "uploaded_asset",
      sectionId: null,
    })),
  ];

  if (project.sections.length) return heroSectionAssets;

  const unique = merged.filter(
    (item, index, list) =>
      item.asset?.filePath && list.findIndex((entry) => entry.asset?.filePath === item.asset?.filePath) === index,
  );

  return unique.slice(0, previewConfig.heroImageCount);
}

function buildDetailAssets(project: {
  sections: Array<{
    id: string;
    order: number;
    title: string;
    type: string;
    sectionKey: string;
    currentImageAsset: any | null;
  }>;
  modelSnapshot: unknown;
}) {
  return project.sections
    .filter((section) => section.type !== "HERO")
    .filter((section) => Boolean(section.currentImageAsset))
    .map((section) => ({
      section,
      asset: section.currentImageAsset,
      sourceLabel:
        sectionTypeLabels[section.type.toLowerCase() as keyof typeof sectionTypeLabels] ?? section.sectionKey,
    }));
}

const EXPORT_HERO_DIR = "00-\u5934\u56fe";
const EXPORT_DETAIL_DIR = "01-\u8be6\u60c5\u9875";

function buildExportImageFileName(exportTimestamp: number, group: "hero" | "detail", index: number, ext: string) {
  const normalizedExt = ext.startsWith(".") ? ext : `.${ext}`;
  return `mx_${exportTimestamp}_${group}_${String(index + 1).padStart(2, "0")}${normalizedExt}`;
}

type ExportCompleteness = {
  plannedCount: number;
  generatedCount: number;
  missingSections: Array<{ sectionId: string; title: string }>;
};

export class IncompleteExportError extends Error {
  constructor(public readonly details: ExportCompleteness) {
    super(`无法完整导出：已生成 ${details.generatedCount}/${details.plannedCount} 个模块，缺少：${details.missingSections.map((section) => section.title).join("、")}。请先补齐图片后重试。`);
    this.name = "IncompleteExportError";
  }
}

export async function buildProjectJson(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      assets: true,
      analysis: true,
      sections: {
        orderBy: { order: "asc" },
        include: {
          versions: {
            orderBy: { versionNumber: "desc" },
          },
        },
      },
    },
  });

  if (!project) {
    throw new Error("Project not found.");
  }

  return project;
}

export async function buildImageArchive(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: {
      assets: {
        orderBy: [{ isMain: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      },
      sections: {
        orderBy: { order: "asc" },
        include: {
          currentImageAsset: true,
          versions: {
            orderBy: { versionNumber: "desc" },
            include: {
              imageAsset: true,
            },
          },
        },
      },
    },
  });

  if (!project) {
    throw new Error("Project not found.");
  }

  const missingSections = project.sections
    .filter((section) => section.currentImageAsset?.type !== "GENERATED" || !section.currentImageAsset.filePath)
    .map((section) => ({ sectionId: section.id, title: section.title || section.sectionKey }));
  const completeness: ExportCompleteness = {
    plannedCount: project.sections.length,
    generatedCount: project.sections.length - missingSections.length,
    missingSections,
  };
  if (missingSections.length) throw new IncompleteExportError(completeness);

  const existingTask = await findRecentRunningTask({
    projectId,
    taskType: "EXPORT",
    maxAgeMinutes: 10,
  });
  if (existingTask) {
    throw new Error("当前导出任务仍在进行中，请等待这一轮完成后再试。");
  }

  const task = await createTask({
    projectId,
    taskType: "EXPORT",
    inputPayload: { type: "detail-page-images" },
  });

  try {
    const exportTimestamp = Date.now();
    const galleryAssets = buildGalleryAssets(project);
    const detailAssets = buildDetailAssets(project);

    // Read before opening a ZIP stream so missing files cannot leave an unfinished archive.
    const imageEntries = await Promise.all([
      ...galleryAssets.map(async (item, index) => {
        const buffer = await readStorageFile(item.asset.filePath);
        const ext = path.extname(item.asset.fileName) || `.${extFromMime(item.asset.mimeType)}`;
        return { buffer, name: `${EXPORT_HERO_DIR}/${buildExportImageFileName(exportTimestamp, "hero", index, ext)}` };
      }),
      ...detailAssets.map(async (item, index) => {
        const buffer = await readStorageFile(item.asset.filePath);
        const ext = path.extname(item.asset.fileName) || `.${extFromMime(item.asset.mimeType)}`;
        return { buffer, name: `${EXPORT_DETAIL_DIR}/${buildExportImageFileName(exportTimestamp, "detail", index, ext)}` };
      }),
    ]);

    const manifest = {
      projectId: project.id,
      projectName: project.name,
      exportedAt: new Date().toISOString(),
      exportTimestamp,
      heroImageCount: galleryAssets.length,
      detailImageCount: detailAssets.length,
      completeness,
      previewConfig: getPreviewConfig(project),
      outputLanguageLabel: contentLanguageLabels[getPreviewConfig(project).contentLanguage],
      gallery: galleryAssets.map((item, index) => ({
        order: index + 1,
        title: item.title,
        sourceLabel: item.sourceLabel,
        source: item.source,
        sectionId: item.sectionId,
        assetId: item.asset.id,
        fileName: buildExportImageFileName(
          exportTimestamp,
          "hero",
          index,
          path.extname(item.asset.fileName) || `.${extFromMime(item.asset.mimeType)}`,
        ),
        originalFileName: item.asset.fileName,
        zipPath: `${EXPORT_HERO_DIR}/${buildExportImageFileName(
          exportTimestamp,
          "hero",
          index,
          path.extname(item.asset.fileName) || `.${extFromMime(item.asset.mimeType)}`,
        )}`,
        mimeType: item.asset.mimeType,
      })),
      details: detailAssets.map((item, index) => ({
        order: index + 1,
        sectionKey: item.section.sectionKey,
        title: item.section.title,
        sectionType: item.section.type,
        sourceLabel: item.sourceLabel,
        source: "generated_section",
        sectionId: item.section.id,
        assetId: item.asset.id,
        fileName: buildExportImageFileName(
          exportTimestamp,
          "detail",
          index,
          path.extname(item.asset.fileName) || `.${extFromMime(item.asset.mimeType)}`,
        ),
        originalFileName: item.asset.fileName,
        zipPath: `${EXPORT_DETAIL_DIR}/${buildExportImageFileName(
          exportTimestamp,
          "detail",
          index,
          path.extname(item.asset.fileName) || `.${extFromMime(item.asset.mimeType)}`,
        )}`,
        mimeType: item.asset.mimeType,
      })),
    };

    const archive = archiver("zip", { zlib: { level: 9 } });
    const tempZipPath = path.join(process.cwd(), `tmp-export-${projectId}-${exportTimestamp}.zip`);
    const output = fs.createWriteStream(tempZipPath);
    let zipBuffer: Buffer;
    try {
      // Register before piping/finalizing: small archives can close immediately.
      const closed = new Promise<void>((resolve, reject) => {
        output.once("close", resolve);
        output.once("error", reject);
        archive.once("error", reject);
      });
      archive.pipe(output);
      for (const entry of imageEntries) archive.append(entry.buffer, { name: entry.name });
      archive.append(JSON.stringify(manifest, null, 2), { name: "export-manifest.json" });
      await Promise.all([archive.finalize(), closed]);
      zipBuffer = await fsp.readFile(tempZipPath);
    } finally {
      archive.abort();
      if (!output.closed) {
        await new Promise<void>((resolve) => {
          output.once("close", resolve);
          output.destroy();
        });
      }
      await fsp.rm(tempZipPath, { force: true });
    }

    await completeTask(task.id, {
      exportedHeroImages: galleryAssets.length,
      exportedDetailImages: detailAssets.length,
    });

    return zipBuffer;
  } catch (error) {
    await failTask(task.id, error instanceof Error ? error.message : "Export failed");
    throw error;
  }
}
