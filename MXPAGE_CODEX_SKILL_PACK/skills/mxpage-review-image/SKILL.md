---
name: mxpage-review-image
description: 将最新生成图与主商品图、模块目标和统一视觉规范逐项对比，输出可执行的 MxPage 图片质检报告。用于决定接受、修订或阻塞；不修改图片。
---

# MxPage 图片质检

这是为 Codex 测试阶段显式增加的验证节点。MxPage 原项目主要依赖 Prompt 检查清单，并没有同等的自动生成后视觉质检闭环。

## 前置条件

1. 读取项目、商品分析、页面规划、目标 Prompt、`outputs/index.json` 和当前图片版本。
2. 用户未指定 section 时，选择第一个 `reviewStatus: pending` 的模块；多个候选无法唯一确定时列出候选并询问。
3. 读取 [质检量表](references/qa-rubric.md)。

## 执行

1. 用图像查看能力分别检查主商品图和当前生成图。不能只读 Prompt 或文件名推断结果。
2. 按量表逐项记录可观察证据、缺陷位置、严重级别和修订动作。
3. 先检查关键失败项，再评分。存在关键失败时结论不得为 `accepted`，无论总分多少。
4. 把每条修订建议写成一次图片编辑可执行的单一变化，并列出必须保持不变的内容。
5. 保存 `reviews/<sectionId>/vNNN-review.json`，更新 `outputs/index.json` 的 `reviewStatus`。
6. 若通过，状态为 `accepted`；若可修复，状态为 `revise`；事实或素材不足导致无法判断时为 `blocked`。
7. 追加运行日志并向用户展示分数、关键证据和结论。

## 交接

- `accepted`：继续编译/生成下一个模块，全部完成后用 `$mxpage-export-project`。
- `revise`：下一步用 `$mxpage-revise-image`，不得在本 Skill 内直接编辑。
- `blocked`：只询问解除阻塞所需的最小事实或素材。
