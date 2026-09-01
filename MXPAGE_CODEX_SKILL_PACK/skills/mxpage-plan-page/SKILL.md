---
name: mxpage-plan-page
description: 将结构化商品分析转换为 MxPage 风格的主图、详情页模块和统一视觉规范。用于商品分析完成后的页面信息架构与视觉系统设计；不调用图片模型。
---

# MxPage 页面规划

生成精确数量、职责互补且共享同一视觉系统的页面模块。

## 前置条件

1. 定位唯一项目并读取 `project.json` 与 `analysis/product-analysis.json`。
2. 商品分析不存在或结构不完整时停止，要求先运行 `$mxpage-analyze-product`。
3. 读取 [页面规划契约](references/page-plan-contract.md)。

## 执行

1. 使用 `project.json` 的平台、风格、语言、hero/详情图画幅和数量。hero 固定为 `1:1`，详情图使用 `detailAspectRatio`。`countSource` 为 `default` 且用户要求自动决策时，可根据商品复杂度调整数量并写回 `countSource: ai`；否则不得擅自修改数量。
2. 先定义一个项目级 `visualStyleGuide`，再规划模块。它是所有图片的视觉一致性合同。
3. 输出恰好 `heroImageCount + detailSectionCount` 个模块；所有 hero 在前，其他模块在后。
4. 每张 hero 必须有不同的首屏沟通职责；详情模块覆盖卖点、场景、细节、参数、材质、对比、信任或总结，不机械重复。
5. 把 `generationRequirements` 转换成不同模块中的镜头、场景、道具、交互和图内文案，不只复述要求。
6. 每个模块写明商品特有的错误禁区。基于真实结构检查线缆、进排口、开口、铰链、把手、支撑点、重力、液体/气流、阴影、反射与手部交互。
7. 验证模块数量、顺序、ID 唯一性、类型合法性、职责不重复、共享风格锚点不为空。
8. 保存为 `planning/page-plan.json`，更新项目状态为 `PLANNED`，追加运行日志。

## 输出与交接

- 返回规划文件绝对路径、模块数量和一行 Visual Style Guide 摘要。
- 明确下一步用 `$mxpage-compile-prompt` 编译一个指定模块；不得直接生图。
