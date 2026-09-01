# 导出契约

```text
exports/<UTC-timestamp>/
├── hero/
├── detail/
├── export-manifest.json
└── delivery-summary.md
exports/<UTC-timestamp>.zip
```

## export-manifest.json

```json
{
  "schemaVersion": "mxpage-codex/v0.1",
  "projectId": "product-demo",
  "exportedAt": "ISO-8601",
  "partial": false,
  "platform": "generic-ecommerce",
  "contentLanguage": "zh-CN",
  "heroAspectRatio": "1:1",
  "detailAspectRatio": "9:16",
  "visualStyleGuide": {},
  "items": [
    {
      "order": 1,
      "sectionId": "hero-01",
      "type": "hero",
      "title": "string",
      "version": 3,
      "sourcePath": "outputs/hero-01/v003.png",
      "exportPath": "hero/01-hero-01-v003.png",
      "promptPath": "prompts/hero-01.json",
      "reviewPath": "reviews/hero-01/v003-review.json",
      "reviewScore": 92
    }
  ],
  "missingSections": []
}
```

验收：`items` 顺序和规划一致；每个路径存在；接受状态与版本一致；ZIP 中包含全部列出的导出文件及两份说明文件。
