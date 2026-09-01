# MxPage Codex 节点 Skill 分发包

这是 MxPage 制作流程的节点级 Skill 测试包（v0.1）。它用于让测试者逐节点运行、检查中间产物并与 MxPage 原项目效果对照；它还不是自动串行执行的完整工作流、Plugin 或 MCP。

## 包含内容

```text
MXPAGE_CODEX_SKILL_PACK/
├─ README.md
├─ MXPAGE_CODEX_SKILL_TEST_GUIDE.md
└─ skills/
   ├─ mxpage-intake/
   ├─ mxpage-analyze-product/
   ├─ mxpage-plan-page/
   ├─ mxpage-compile-prompt/
   ├─ mxpage-generate-image/
   ├─ mxpage-review-image/
   ├─ mxpage-revise-image/
   └─ mxpage-export-project/
```

本包使用普通 `skills/` 目录保存文件，因此把整个分发包放进项目不会自动加载这些 Skill。

## 安装

把 `skills/` 下的 8 个完整目录复制到待测试项目的 `.agents/skills/`：

```text
<目标项目>/.agents/skills/
```

请保留每个 Skill 内的 `SKILL.md`、`agents/` 和 `references/`。安装后重新打开目标项目或重启 Codex，再按 `$skill-name` 显式调用。

## 建议调用顺序

1. `$mxpage-intake`
2. `$mxpage-analyze-product`
3. `$mxpage-plan-page`
4. `$mxpage-compile-prompt`
5. `$mxpage-generate-image`
6. `$mxpage-review-image`
7. `$mxpage-revise-image`（仅在质检要求修订时）
8. `$mxpage-export-project`

完整输入模板、验收标准与对照测试方法见 [MXPAGE_CODEX_SKILL_TEST_GUIDE.md](MXPAGE_CODEX_SKILL_TEST_GUIDE.md)。生图与修订节点依赖 Codex 可用的内置 `$imagegen` 能力。
