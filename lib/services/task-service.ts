import { Prisma, type GenerationTask, type TaskStatus, type TaskType } from "@prisma/client";

import { prisma } from "@/lib/db/prisma";

export type MxTaskType = TaskType;

const globalTaskAbortControllers = globalThis as typeof globalThis & {
  mxpageTaskAbortControllers?: Map<string, AbortController>;
};
const taskAbortControllers =
  globalTaskAbortControllers.mxpageTaskAbortControllers ?? new Map<string, AbortController>();

if (process.env.NODE_ENV !== "production") {
  globalTaskAbortControllers.mxpageTaskAbortControllers = taskAbortControllers;
}

function toJsonValue(value: unknown) {
  return (value ?? Prisma.JsonNull) as Prisma.InputJsonValue;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

const activeTaskStatuses: TaskStatus[] = ["PENDING", "RUNNING"];

// Take the SQLite write lock before reading JSON. A read-then-write transaction
// can still lose a concurrent heartbeat; this conditional write serializes it.
async function withActiveTask(
  taskId: string,
  update: (tx: Prisma.TransactionClient, task: GenerationTask) => Promise<GenerationTask>,
  client?: Prisma.TransactionClient,
) {
  const run = async (tx: Prisma.TransactionClient) => {
    // Do not touch updatedAt while merely acquiring the lock: stale-task
    // detection must observe the last real activity, not its own status poll.
    const claimed = await tx.$executeRaw`UPDATE "GenerationTask" SET "id" = "id"
      WHERE "id" = ${taskId} AND "status" IN ('PENDING', 'RUNNING')`;
    const task = await tx.generationTask.findUnique({ where: { id: taskId } });
    if (!claimed || !task) {
      if (client) throw new Error(task?.status === "CANCELED" ? "Task canceled." : "Task stopped.");
      return task;
    }
    return update(tx, task);
  };
  return client ? run(client) : prisma.$transaction(run);
}

export async function createTask(input: {
  projectId: string;
  sectionId?: string | null;
  taskType: MxTaskType;
  inputPayload?: unknown;
  outputPayload?: unknown;
  status?: TaskStatus;
}) {
  const status = input.status ?? "RUNNING";
  const create = (client: Prisma.TransactionClient) => client.generationTask.create({
    data: {
      projectId: input.projectId,
      sectionId: input.sectionId ?? null,
      taskType: input.taskType,
      status,
      startedAt: status === "RUNNING" ? new Date() : null,
      inputPayload: toJsonValue(input.inputPayload),
      outputPayload: toJsonValue(input.outputPayload),
    },
  });
  const isImageTask = input.taskType === "GENERATE" || input.taskType === "REGENERATE";
  const retryOfTaskId = asRecord(input.inputPayload).retryOfTaskId;
  if ((!isImageTask && typeof retryOfTaskId !== "string") || !activeTaskStatuses.includes(status)) {
    return create(prisma);
  }
  return prisma.$transaction(async (tx) => {
    // Project-scoped claim prevents two requests from both observing no owner.
    await tx.project.update({ where: { id: input.projectId }, data: { id: input.projectId } });
    const existing = isImageTask ? await tx.generationTask.findFirst({
      where: {
        projectId: input.projectId,
        ...(input.sectionId ? { sectionId: input.sectionId } : {}),
        taskType: { in: ["GENERATE", "REGENERATE"] },
        status: { in: activeTaskStatuses },
      },
    }) : null;
    if (existing) throw new Error("当前模块或页面已有图片生成任务。若服务曾中断，请先使用模块上的终止按钮取消遗留任务，再重试。");
    if (typeof retryOfTaskId === "string") {
      const retries = await tx.generationTask.findMany({
        where: { projectId: input.projectId, taskType: input.taskType, status: { in: activeTaskStatuses } },
        select: { inputPayload: true },
      });
      if (retries.some((task) => asRecord(task.inputPayload).retryOfTaskId === retryOfTaskId)) {
        throw new Error("Task retry is already running.");
      }
    }
    return create(tx);
  });
}

export async function findRecentRunningTask(input: {
  projectId: string;
  taskType: MxTaskType;
  sectionId?: string | null;
  maxAgeMinutes?: number;
}) {
  const maxAgeMinutes = input.maxAgeMinutes ?? 10;
  const startedAfter = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

  return prisma.generationTask.findFirst({
    where: {
      projectId: input.projectId,
      sectionId: input.sectionId ?? null,
      taskType: input.taskType,
      status: "RUNNING",
      startedAt: {
        gte: startedAfter,
      },
    },
    orderBy: {
      startedAt: "desc",
    },
  });
}

export async function getTask(taskId: string) {
  return prisma.generationTask.findUnique({
    where: { id: taskId },
  });
}

export async function startTask(taskId: string, patch?: unknown) {
  return withActiveTask(taskId, (tx, current) => tx.generationTask.update({
    where: { id: taskId },
    data: {
      status: "RUNNING",
      startedAt: current?.startedAt ?? new Date(),
      outputPayload: toJsonValue({
        ...asRecord(current?.outputPayload),
        ...asRecord(patch),
      }),
    },
  }));
}

export async function updateTaskProgress(taskId: string, patch: Record<string, unknown>) {
  return withActiveTask(taskId, (tx, current) => tx.generationTask.update({
    where: { id: taskId },
    data: {
      outputPayload: toJsonValue({
        ...asRecord(current.outputPayload),
        ...patch,
        updatedAt: new Date().toISOString(),
      }),
    },
  }));
}

export async function completeTask(taskId: string, outputPayload?: unknown, client?: Prisma.TransactionClient) {
  return withActiveTask(taskId, (tx, current) => tx.generationTask.update({
    where: { id: taskId },
    data: {
      status: "SUCCESS",
      completedAt: new Date(),
      outputPayload: toJsonValue({
        ...asRecord(current?.outputPayload),
        ...asRecord(outputPayload),
        completedAt: new Date().toISOString(),
      }),
    },
  }), client);
}

export async function failTask(taskId: string, errorMessage: string, outputPayload?: unknown) {
  return withActiveTask(taskId, (tx, current) => tx.generationTask.update({
    where: { id: taskId },
    data: {
      status: "FAILED",
      completedAt: new Date(),
      errorMessage,
      outputPayload: toJsonValue({
        ...asRecord(current?.outputPayload),
        ...asRecord(outputPayload),
        failedAt: new Date().toISOString(),
      }),
    },
  }));
}

export async function cancelTask(taskId: string) {
  const abortIds: string[] = [];
  const canceled = await withActiveTask(taskId, async (tx, task) => {
    const output = asRecord(task.outputPayload);
    const currentTaskId = typeof output.currentTaskId === "string" ? output.currentTaskId : null;
    const currentTask = currentTaskId ? await tx.generationTask.findUnique({ where: { id: currentTaskId } }) : null;
    const result = await tx.generationTask.update({
      where: { id: taskId },
      data: {
        status: "CANCELED",
        completedAt: new Date(),
        errorMessage: "Canceled by user.",
      },
    });

    let canceledChild = false;
    if (currentTaskId) {
      const child = await tx.generationTask.updateMany({
        where: { id: currentTaskId, status: { in: ["PENDING", "RUNNING"] } },
        data: {
          status: "CANCELED",
          completedAt: new Date(),
          errorMessage: "Canceled by user.",
        },
      });
      canceledChild = child.count > 0;
      if (canceledChild) abortIds.push(currentTaskId);
    }

    abortIds.push(taskId);

    const sectionIds = [task.sectionId, canceledChild ? currentTask?.sectionId : null].filter(
      (sectionId): sectionId is string => typeof sectionId === "string",
    );
    for (const sectionId of new Set(sectionIds)) {
      const section = await tx.pageSection.findUnique({
        where: { id: sectionId },
        select: { currentImageAssetId: true },
      });
      if (section) {
        await tx.pageSection.update({
          where: { id: sectionId },
          data: { status: section.currentImageAssetId ? "SUCCESS" : "IDLE" },
        });
      }
    }
    return result;
  });
  if (!canceled) throw new Error("Task not found.");
  for (const id of abortIds) taskAbortControllers.get(id)?.abort(new Error("Task canceled."));
  return canceled;
}

export function registerTaskAbortController(taskId: string) {
  const controller = new AbortController();
  taskAbortControllers.set(taskId, controller);
  return controller.signal;
}

export function releaseTaskAbortController(taskId: string) {
  taskAbortControllers.delete(taskId);
}

export async function recoverStaleBulkGenerationTask(task: GenerationTask | null) {
  if (
    !task ||
    task.taskType !== "GENERATE" ||
    task.sectionId !== null ||
    (task.status !== "PENDING" && task.status !== "RUNNING")
  ) {
    return task;
  }

  const abortIds: string[] = [];
  const recovered = await withActiveTask(task.id, async (tx, current) => {
    const output = asRecord(current.outputPayload);
    const heartbeatAt = typeof output.heartbeatAt === "string" ? Date.parse(output.heartbeatAt) : Number.NaN;
    const fallbackActivityAt = current.updatedAt.getTime();
    const lastActivityAt = Number.isFinite(heartbeatAt) ? heartbeatAt : fallbackActivityAt;
    const staleAfterMs = Number.isFinite(heartbeatAt) ? 90_000 : 5 * 60_000;
    if (Date.now() - lastActivityAt <= staleAfterMs) {
      return current;
    }

    const message = "批量生成后台执行已中断，系统已结束遗留任务，请重新生成未完成模块。";
    const currentTaskId = typeof output.currentTaskId === "string" ? output.currentTaskId : null;
    const currentTask = currentTaskId ? await tx.generationTask.findUnique({ where: { id: currentTaskId } }) : null;

    const result = await tx.generationTask.update({
      where: { id: task.id },
      data: {
        status: "FAILED",
        completedAt: new Date(),
        errorMessage: message,
        outputPayload: toJsonValue({
          ...output,
          currentStep: "stale_task_recovered",
          staleRecoveredAt: new Date().toISOString(),
        }),
      },
    });

    let stoppedChild = false;
    if (currentTaskId) {
      const child = await tx.generationTask.updateMany({
        where: { id: currentTaskId, status: { in: ["PENDING", "RUNNING"] } },
        data: { status: "FAILED", completedAt: new Date(), errorMessage: message },
      });
      stoppedChild = child.count > 0;
      if (stoppedChild) abortIds.push(currentTaskId);
    }

    if (stoppedChild && currentTask?.sectionId) {
      const section = await tx.pageSection.findUnique({
        where: { id: currentTask.sectionId },
        select: { currentImageAssetId: true },
      });
      if (section) {
        await tx.pageSection.update({
          where: { id: currentTask.sectionId },
          data: { status: section.currentImageAssetId ? "SUCCESS" : "IDLE" },
        });
      }
    }

    abortIds.push(current.id);
    return result;
  });
  for (const id of abortIds) taskAbortControllers.get(id)?.abort(new Error("Task canceled."));
  return recovered;
}

export async function getTaskWithStaleRecovery(taskId: string) {
  return recoverStaleBulkGenerationTask(await getTask(taskId));
}

export async function assertTaskNotCanceled(taskId: string, client?: Prisma.TransactionClient) {
  const task = client
    ? await withActiveTask(taskId, async (_tx, current) => current, client)
    : await getTask(taskId);
  if (task?.status === "CANCELED") {
    throw new Error("Task canceled.");
  }
  if (task?.status === "FAILED") {
    throw new Error(task.errorMessage || "Task stopped.");
  }
  return task;
}

export function runTaskInBackground(handler: () => Promise<void>) {
  void handler().catch((error) => {
    console.error("[Task Runner] Unhandled background task error", error);
  });
}
