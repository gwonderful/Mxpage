import type { NextRequest } from "next/server";
import { inspectCodex, isCodexProvider } from "@/lib/ai/codex-app-server";
import { activateLocalCodex, getActiveProviderConfig } from "@/lib/services/provider-service";
import { isLocalCodexRequest } from "@/lib/services/provider-runtime";
import { fail, handleRouteError, ok } from "@/lib/utils/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isLocalCodexRequest(request)) return fail("LOCAL_ONLY", "请在本机打开设置页。", null, 403);
  try {
    const status = await inspectCodex();
    const provider = await getActiveProviderConfig();
    return ok({ ...status, active: Boolean(provider && isCodexProvider(provider.baseUrl)) });
  } catch (error) { return handleRouteError(error); }
}

export async function POST(request: NextRequest) {
  if (!isLocalCodexRequest(request)) return fail("LOCAL_ONLY", "请在本机打开设置页。", null, 403);
  try { return ok(await activateLocalCodex()); }
  catch (error) { return handleRouteError(error); }
}
