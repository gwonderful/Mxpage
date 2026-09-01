---
name: mxpage-generate-image
description: 使用已编译的 MxPage 模块 Prompt 和商品参考图生成一张电商图片并保存版本记录。仅用于 Prompt 编译完成后的实际生图节点；不负责重新分析商品或改变页面规划。
---

# MxPage 图片生成

一个调用只生成一个模块的一张候选图，以便独立对比质量、成本和漂移。

## 前置条件

1. 定位项目并读取 `project.json`、`planning/page-plan.json` 和目标 `prompts/<sectionId>.json`。
2. 用户未指定 section 时，选择按模块顺序排列后第一个没有成功生成记录的模块，并明确告知。
3. Prompt 工件缺失时停止，要求先运行 `$mxpage-compile-prompt`，不得临时绕过编译节点。
4. 读取 [生成记录契约](references/generation-record-contract.md)。

## 执行

1. 本 Skill 依赖 `$imagegen`。调用图片工具前必须读取并遵循该 Skill，默认使用内置图片生成，不要求 API Key。
2. 将 `finalPrompt` 作为主提示词，将 `negativePrompt` 与 `qualityChecklist` 合并为明确约束；不得擅自改变模块目标、图内文案或商品事实。
3. 对每张参考图标明角色。主图必须作为商品身份参考；其他图只承担细节、场景或风格参考。
4. 调用内置图片生成一次。需要多个不同模块时，每个模块单独调用，不用一个提示词混合生成多张页面。
5. 生成后将项目使用的最终图片复制到 `outputs/<sectionId>/vNNN.<ext>`；不得覆盖旧版本，也不得只留在 Codex 默认生成目录。
6. 写入同名 `vNNN.json` 生成记录，并更新 `outputs/index.json` 中该模块的 `currentVersion`。
7. 更新项目状态为 `GENERATED_PENDING_REVIEW`，追加运行日志，内联展示图片并报告保存路径。

## 停止条件

- 内置图片工具失败时报告失败。只有用户明确选择 CLI/API 回退后才能切换；不得静默更换模型或生成 SVG 占位图。
- 不在本节点自动反复生成“直到满意”。下一步必须是 `$mxpage-review-image`。
