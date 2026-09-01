---
name: mxpage-export-project
description: 将通过质检的 MxPage 主图和详情图按页面顺序复制到交付目录，并生成项目清单与 ZIP。用于所有必需模块完成后的最终导出；不接受未质检或被阻塞的图片。
---

# MxPage 项目导出

只打包被明确接受的当前版本，保留可追溯信息。

## 前置条件

1. 读取 `project.json`、`planning/page-plan.json`、`outputs/index.json` 和所有当前版本 review。
2. 读取 [导出契约](references/export-contract.md)。
3. 检查规划中的每个必需模块都有当前图片且 `reviewStatus: accepted`。任何缺失、`pending`、`revise` 或 `blocked` 都必须先报告，不得静默导出半成品，除非用户明确要求部分导出。

## 执行

1. 创建新的 `exports/<UTC-timestamp>/`，不得覆盖历史导出。
2. 按 `page-plan.json` 的 `order` 复制当前接受版本：hero 放到 `hero/`，其他模块放到 `detail/`。复制而不是移动源图片。
3. 文件名使用两位顺序号、section ID 和版本号，例如 `01-hero-01-v003.png`。
4. 生成 `export-manifest.json`，记录项目配置、Visual Style Guide、每张图的模块、版本、源路径、导出路径、Prompt 路径、review 路径和分数。
5. 生成 `delivery-summary.md`，列出交付数量、顺序、目标平台/语言/画幅、已知限制和测试备注。
6. 将该时间戳目录压缩为同级 ZIP；校验 ZIP 存在、非空，清单中的每个文件都已包含。
7. 更新项目状态为 `EXPORTED`，追加运行日志，返回目录和 ZIP 的绝对路径。

## 边界

- 部分导出必须在目录名和清单中标记 `partial: true`，并列出未交付模块。
- 不删除中间工件、旧版本、review 或先前导出。
- 本节点不调用图片生成或修改视觉内容。
