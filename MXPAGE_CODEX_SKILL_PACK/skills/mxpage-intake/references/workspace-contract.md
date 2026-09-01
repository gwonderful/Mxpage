# 工作区协议

## 目录

```text
mxpage-workspace/<projectId>/
├── project.json
├── assets/
│   ├── main/
│   └── reference/
├── analysis/
├── planning/
├── prompts/
├── outputs/
├── reviews/
├── exports/
└── run-log.md
```

所有 JSON 中的项目内路径使用相对项目根目录的正斜杠路径。任何节点重写稳定文件前，先把旧文件复制到同目录的 `history/`，文件名附加 UTC 时间戳。

## project.json

```json
{
  "schemaVersion": "mxpage-codex/v0.1",
  "projectId": "product-demo",
  "name": "商品项目名称",
  "description": "用户提供的事实；没有则为空字符串",
  "platform": "generic-ecommerce",
  "style": "auto",
  "contentLanguage": "zh-CN",
  "heroAspectRatio": "1:1",
  "detailAspectRatio": "9:16",
  "heroImageCount": 4,
  "detailSectionCount": 6,
  "countSource": "default | user | ai",
  "generationRequirements": "",
  "state": "INTAKE_READY",
  "assets": [
    {
      "id": "asset-main-01",
      "role": "main | reference",
      "type": "product | detail | scenario | package | style-reference",
      "path": "assets/main/product.png",
      "isMain": true,
      "notes": ""
    }
  ],
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

约束：

- `assets` 至少一项，且恰好一个主图。
- `heroAspectRatio` 固定为 `1:1`；`detailAspectRatio` 只允许 `3:4` 或 `9:16`，默认 `9:16`。
- 不把推测写成用户事实。
- 默认数量来自 MxPage 当前默认规划值，不代表所有项目的最优数量。
- 后续节点只修改自己的产物、`state`、`updatedAt` 和必要的交接字段。
