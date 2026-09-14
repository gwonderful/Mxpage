"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Status = { active: boolean; planType?: string; imageGeneration: boolean; models: Array<{ model: string; isDefault: boolean }> };

export function CodexAccountSettings() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/providers/codex", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error?.message || "无法读取 Codex 登录状态");
      setStatus(payload.data);
    } catch (err) { setStatus(null); setError(err instanceof Error ? err.message : "连接失败"); }
    finally { setBusy(false); }
  }

  async function activate() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/providers/codex", { method: "POST" });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error?.message || "启用失败");
      window.location.reload();
    } catch (err) { setError(err instanceof Error ? err.message : "启用失败"); setBusy(false); }
  }

  useEffect(() => { void refresh(); }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle>使用本机 Codex 账号</CardTitle>
        <CardDescription>通过本机 Codex 已登录的 ChatGPT 账号完成商品分析、规划、生图和改图，无需填写 API Key。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1 text-sm" aria-live="polite">
          {status && <p>{status.active ? "已启用" : "已连接"} · {status.planType || "ChatGPT"} · 默认模型 {status.models.find((model) => model.isDefault)?.model || "由 Codex 决定"} · 图片生成{status.imageGeneration ? "可用" : "不可用"}</p>}
          {error && <p className="text-destructive">{error}</p>}
          <p className="text-muted-foreground">用量计入当前账号额度。服务需要运行在已登录 Codex 的电脑上；图片模型由 Codex 管理。精确蒙版编辑暂不支持。</p>
          {!status && <p className="text-muted-foreground">首次使用请在本机终端执行 <code>codex login</code>，完成 ChatGPT 登录后刷新状态。</p>}
        </div>
        <div className="flex flex-wrap gap-3">
          <Button onClick={activate} disabled={busy || !status?.imageGeneration || status?.active}>{status?.active ? "当前已使用 Codex 账号" : "启用 Codex 账号"}</Button>
          <Button variant="outline" onClick={refresh} disabled={busy}>{busy ? "正在连接…" : "刷新登录状态"}</Button>
        </div>
      </CardContent>
    </Card>
  );
}
