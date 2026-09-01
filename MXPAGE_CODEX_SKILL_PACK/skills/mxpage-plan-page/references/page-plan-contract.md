# 页面规划契约

```json
{
  "visualStyleGuide": {
    "styleName": "string",
    "colorPalette": "string",
    "backgroundSystem": "string",
    "lighting": "string",
    "cameraLanguage": "string",
    "typography": "string",
    "layoutRules": "string",
    "propRules": "string",
    "productRenderingRules": "string",
    "negativeStyleConstraints": "string"
  },
  "sections": [
    {
      "id": "hero-01",
      "order": 1,
      "type": "hero | selling_points | scenario | detail_closeup | specs | material | comparison | gift_scene | brand_trust | summary | custom",
      "title": "string",
      "goal": "string",
      "copy": "string",
      "visualPrompt": "Primary Prompt: ...\nEnglish Prompt: ...",
      "editableFields": {
        "styleRole": "string",
        "sharedStyleAnchors": ["string"],
        "localVariation": "string",
        "negativeConstraints": ["string"]
      }
    }
  ]
}
```

## 质量要求

- 用户可见的标题、目标、文案和图内文字要求使用项目目标语言。
- `visualPrompt` 同时包含目标语言方向和英文图片 Prompt。
- 每个模块至少有 3 个独有的具体视觉细节：镜头/裁切、商品位置、场景/道具、灯光或文字位置。
- `sharedStyleAnchors` 必须引用统一配色、背景、灯光、字体/CTA、安全边距和商品渲染规则。
- `negativeConstraints` 必须针对当前商品，不得只写“不要低质量”。

