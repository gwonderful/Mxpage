"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { ProviderSettings } from "@/components/providers/provider-settings";
import { CodexAccountSettings } from "@/components/providers/codex-account-settings";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent } from "@/components/ui/card";

type ProviderPageData = Array<{
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  maskedApiKey?: string;
  isActive: boolean;
  updatedAt: string | Date;
  models: Array<{
    modelId: string;
    label: string;
    capabilities: Record<string, unknown>;
    roles: Record<string, unknown>;
    quality?: string | null;
    latency?: string | null;
    cost?: string | null;
    isAvailable: boolean;
    endpointSupport?: {
      imageGeneration: string;
      imageEdit: string;
      note?: string | null;
    };
    isDefaultAnalysis: boolean;
    isDefaultPlanning: boolean;
    isDefaultHeroImage: boolean;
    isDefaultDetailImage: boolean;
    isDefaultImageEdit: boolean;
  }>;
}>;

type RuntimeConfig = {
  baseUrlLocked: boolean;
  lockedBaseUrl: string | null;
};

function LoadingState() {
  return (
    <Card>
      <CardContent className="flex min-h-[260px] items-center justify-center gap-3 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        正在加载 AI 配置...
      </CardContent>
    </Card>
  );
}

export default function ProviderSettingsPageClient() {
  const [mounted, setMounted] = useState(false);
  const [providers, setProviders] = useState<ProviderPageData>([]);
  const [runtimeConfig, setRuntimeConfig] = useState<RuntimeConfig>({
    baseUrlLocked: false,
    lockedBaseUrl: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    let aborted = false;

    async function loadProviders() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch("/api/providers", {
          cache: "no-store",
        });
        const payload = await response.json();

        if (!response.ok || !payload.success) {
          throw new Error(payload.error?.message ?? "加载 AI 配置失败");
        }

        if (!aborted) {
          const data = payload.data;
          setProviders(Array.isArray(data) ? data : data?.providers ?? []);
          setRuntimeConfig(data?.runtime ?? { baseUrlLocked: false, lockedBaseUrl: null });
        }
      } catch (err) {
        if (!aborted) {
          setError(err instanceof Error ? err.message : "加载 AI 配置失败");
        }
      } finally {
        if (!aborted) {
          setLoading(false);
        }
      }
    }

    loadProviders();

    return () => {
      aborted = true;
    };
  }, [mounted]);

  if (!mounted) {
    return (
      <div className="space-y-8" suppressHydrationWarning>
        <LoadingState />
      </div>
    );
  }

  return (
    <div className="space-y-8" suppressHydrationWarning>
      <PageHeader
        eyebrow="模型服务配置"
        title="Provider 与模型配置中心"
        description="选择使用本机 Codex 登录账号，或配置独立的 API 服务。"
      />

      <CodexAccountSettings />

      {loading ? (
        <LoadingState />
      ) : error ? (
        <Card>
          <CardContent className="min-h-[180px] space-y-2 pt-6 text-sm">
            <p className="font-medium text-destructive">加载失败</p>
            <p className="text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      ) : (
        <details className="space-y-4" open={!providers.some((provider) => provider.isActive && provider.baseUrl === "codex://local")}>
          <summary className="cursor-pointer text-sm font-medium">API 服务配置</summary>
          <ProviderSettings initialProviders={providers.filter((provider) => provider.baseUrl !== "codex://local")} runtimeConfig={runtimeConfig} />
        </details>
      )}
    </div>
  );
}
