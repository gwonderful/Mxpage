# MxPage Codex 节点 Skill 测试指南

> 当前阶段：节点级 Skill 验证（v0.1）  
> 暂不包含：总控工作流 Skill、Plugin、MCP、自动批量编排。

## 1. 目标与阶段边界

本阶段把 MxPage 的业务制作流程拆成 8 个可单独调用、可查看中间产物、可逐节点修正的仓库级 Skill。分发包中的 Skill 保存在普通目录 `skills/`，仅存放在此处不会被 Codex 自动加载。

测试前，请先按下一节把 8 个 Skill 复制到待测试项目的 `.agents/skills/`。安装后既可让 Codex 按描述自动选择，也可通过 `$skill-name` 显式调用。如果当前已打开的 Codex 任务没有立即显示新 Skill，请重启 Codex 后回到目标项目再调用。

官方建议先用 Skill 设计和验证可复用工作流，再在需要分发一个或多个 Skill 时打包为 Plugin。[OpenAI：Build skills](https://learn.chatgpt.com/docs/build-skills)

只有满足以下条件后才进入完整技能包阶段：

1. 使用同一组商品素材，Codex 流程与 MxPage 的分析、页面规划和图片质量达到可接受的一致性。
2. 连续多个真实商品项目没有出现相同的结构性失败。
3. 各节点输入输出格式稳定，不再频繁改字段。
4. 已确定哪些步骤需要用户确认，哪些可以自动继续。
5. 已记录图片调用量、平均修订次数和常见失败类型。

## 2. 安装到待测试项目

将本分发包 `skills/` 下的 8 个完整目录复制到目标项目：

```text
<目标项目>/.agents/skills/
```

安装后的目录示例：

```text
<目标项目>/.agents/skills/mxpage-intake/SKILL.md
<目标项目>/.agents/skills/mxpage-analyze-product/SKILL.md
...
<目标项目>/.agents/skills/mxpage-export-project/SKILL.md
```

不要只复制 `SKILL.md`；每个 Skill 的 `agents/` 与 `references/` 也必须保留。若只想保存或转发本包，无需安装，直接保持当前目录结构即可。

## 3. 原项目节点与 Skill 映射

| MxPage 节点 | Codex Skill | 主要产物 |
|---|---|---|
| 上传主图 + 创建项目 | `$mxpage-intake` | `project.json`、标准素材目录 |
| 分析商品 | `$mxpage-analyze-product` | `analysis/product-analysis.json` |
| 规划模块 | `$mxpage-plan-page` | `planning/page-plan.json`、Visual Style Guide |
| Visual Prompt Agent | `$mxpage-compile-prompt` | `prompts/<sectionId>.json` |
| 提交生成 + 后台逐图生成 | `$mxpage-generate-image` | `outputs/<sectionId>/vNNN.*` |
| 审阅 | `$mxpage-review-image` | `reviews/<sectionId>/vNNN-review.json` |
| 重绘/增强/翻译 | `$mxpage-revise-image` | 新图片版本与修订记录 |
| 导出 | `$mxpage-export-project` | hero/detail、Manifest、交付摘要和 ZIP |

SQLite、文件存储、Provider 和后台心跳是原应用的基础设施，不是用户可独立验收的创作节点，因此没有伪装成单独 Skill。它们在 Codex 版本中分别由项目工件目录、Codex 内置图片生成和当前任务执行环境承担。

## 4. 固定调用顺序

### 第 1 步：项目接入

```text
$mxpage-intake
为“<项目名>”建立项目。主商品图是 <路径或附件>，参考图是 <路径或附件列表>。
平台：<平台>；风格：<风格>；语言：zh-CN；hero 画幅：1:1；详情图画幅：9:16；主图 4 张；详情图 6 张。
额外要求：<要求>。
```

验收：得到 `mxpage-workspace/<projectId>/project.json`，所有素材路径存在，恰好一张主图。

### 第 2 步：商品分析

```text
$mxpage-analyze-product
分析 mxpage-workspace/<projectId>，只完成商品分析节点。
```

验收：商品类别、外观结构、卖点和不确定参数与 MxPage 分析页对照；未知精确值不得被编造。

### 第 3 步：页面规划

```text
$mxpage-plan-page
规划 mxpage-workspace/<projectId>，保持 project.json 中的数量、平台、语言和画幅。
```

验收：模块总数精确，hero 全部在前；模块目标不重复；共享 Visual Style Guide 足够具体。

### 第 4 步：逐图 Prompt 编译

```text
$mxpage-compile-prompt
为 mxpage-workspace/<projectId> 的 <sectionId> 编译图片 Prompt，不要生成图片。
```

验收：Prompt 包含主图身份、不变量、具体构图、图内文字、共享视觉规范、物理规则和 Negative Prompt。

### 第 5 步：生成单张图片

```text
$mxpage-generate-image
为 mxpage-workspace/<projectId> 的 <sectionId> 生成一个版本。
```

该节点会按官方默认路径使用内置 `$imagegen`，并把项目使用的图片复制回工作区。内置图片生成支持自然语言、参考图、生成和编辑。[OpenAI：Image generation](https://learn.chatgpt.com/docs/image-generation)

验收：图片被保存为新版本，原素材未覆盖，并有同名生成记录。

### 第 6 步：质检

```text
$mxpage-review-image
质检 mxpage-workspace/<projectId> 的 <sectionId> 当前版本。
```

验收：Codex 实际查看主图和生成图；报告包含证据、分项分数、关键失败项和可执行修订动作。

### 第 7 步：按需修订

仅当 review 为 `revise` 时执行：

```text
$mxpage-revise-image
根据 mxpage-workspace/<projectId> 的 <sectionId> 最新质检报告修订一次。
```

修订后回到第 6 步重新质检。相同问题连续两次修订仍失败时停止，让用户比较版本并决定。

### 第 8 步：循环下一模块并最终导出

对每个模块重复第 4 至第 7 步。全部模块 `accepted` 后：

```text
$mxpage-export-project
导出 mxpage-workspace/<projectId> 中所有通过质检的当前版本。
```

验收：导出顺序与页面规划一致，主图和详情图分目录，Manifest 路径可追溯，ZIP 非空。

## 5. 与 MxPage 对照测试方法

每轮必须让 MxPage 和 Codex 使用完全相同的：

- 主商品图和参考图；
- 项目描述与额外生成要求；
- 主图/详情图数量；
- 平台、语言、画幅和目标风格。

建议先测 3 类商品：结构简单的静物、存在机械/连接关系的商品、图内文字较多的商品。每类至少完成一整套页面后再调整 Skill，避免用单张偶然结果下结论。

## 6. 测试记录模板

| 项目 | MxPage 结果 | Codex Skill 结果 | 差异 | 归属节点 | 是否复现 | 调整建议 |
|---|---|---|---|---|---|---|
| 商品识别 |  |  |  | analyze |  |  |
| 卖点/人群/场景 |  |  |  | analyze |  |  |
| 页面模块职责 |  |  |  | plan |  |  |
| 跨图视觉一致性 |  |  |  | plan/compile |  |  |
| 商品身份一致性 |  |  |  | compile/generate |  |  |
| 物理合理性 |  |  |  | compile/generate |  |  |
| 图内文字 |  |  |  | compile/generate |  |  |
| 修订成功率 |  |  |  | revise |  |  |
| 调用次数与耗时 |  |  |  | 全流程 |  |  |

问题应修改到最早能阻止它的节点：识别错改 analyze；信息架构错改 plan；构图/约束缺失改 compile；模型偶发违约由 review/revise 处理。不要把所有失败都堆进生图 Prompt。

## 7. 稳定后再做的完整技能包

本阶段没有创建以下内容：

- 自动依次调用全部节点的总控 Skill；
- 自动批量生成所有页面的长期任务编排；
- 可安装 Plugin Manifest；
- MCP Server 或外部 Provider 连接器。

节点测试稳定后，再根据实际测试记录决定最终包形态。预计完整包由这 8 个 Skill 加一个总控工作流组成；只有确实需要第三方 Provider、远程任务或共享资产服务时才增加 MCP，而不是为了形式引入 MCP。
