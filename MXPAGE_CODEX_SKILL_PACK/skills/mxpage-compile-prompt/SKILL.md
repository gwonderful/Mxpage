---
name: mxpage-compile-prompt
description: 将一个已规划的 MxPage 页面模块编译为可直接交给图片模型的生产级提示词。用于逐图生图前补齐构图、商品身份、图内文字、物理约束和检查清单；本节点不生成图片。
---

# MxPage 逐图 Prompt 编译

复刻 Visual Prompt Agent，只处理一个页面模块，便于逐节点测试。

## 前置条件

1. 读取项目 `project.json`、`analysis/product-analysis.json` 和 `planning/page-plan.json`。
2. 用户指定 section ID 时使用该模块；未指定时选择按 `order` 排序后第一个尚无 `prompts/<sectionId>.json` 的模块，并明确告知选择结果。
3. 读取 [图片 Prompt 契约](references/image-prompt-contract.md)。

## 执行

1. 主图始终是商品身份事实源。最多选择 3 张与当前模块最相关的图片：主图优先，其次是能证明细节或场景的参考图。
2. 把模块的标题、目标、文案、Visual Style Guide、商品分析、画幅、目标语言和生成要求整合为一个具体 Prompt。hero 使用 `1:1`，其他模块使用项目的 `detailAspectRatio`。
3. Prompt 必须明确前景、中景、背景、镜头、裁切、商品摆位、道具、光线方向、材质、阴影、反射、景深和留白。
4. 图内文字必须逐字列出，并明确标题、卖点、CTA/徽标的位置、层级和安全边距。不要引入分析中没有依据的新参数或功效承诺。
5. 重复商品身份不变量：类别、几何、颜色、材质、部件数量、开口、按钮、接口、标签和比例。
6. 写入商品特有物理规则与不可能现象，不能只使用泛化 Negative Prompt。
7. 生成 `analysisSummary`、`finalPrompt`、`negativePrompt` 和可观察的 `qualityChecklist`，保存为 `prompts/<sectionId>.json`。
8. 验证 Prompt 中包含画幅、目标语言、参考图角色、Visual Style Guide、精确文案、身份不变量和禁止项。追加运行日志。

## 输出与交接

- 返回 Prompt 文件绝对路径、选用的参考图和关键不变量。
- 下一步是 `$mxpage-generate-image`；本节点不得调用 `$imagegen`。
