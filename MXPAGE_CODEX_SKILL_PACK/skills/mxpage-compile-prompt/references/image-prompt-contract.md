# 图片 Prompt 契约

```json
{
  "sectionId": "hero-01",
  "sectionOrder": 1,
  "analysisSummary": "本图的商业与视觉策略摘要",
  "referenceImages": [
    {
      "path": "assets/main/product.png",
      "role": "商品身份事实源"
    }
  ],
  "finalPrompt": "可直接用于图片模型的完整提示词",
  "negativePrompt": "商品特有与通用禁止项",
  "qualityChecklist": ["可从生成图中判断真假的检查项"],
  "compiledAt": "ISO-8601"
}
```

## finalPrompt 必含内容

- 用途：电商主图或详情页模块、目标受众和商业目标。
- 画布：比例、裁切、内容安全区。
- 商品身份：主图为事实源及必须保持的具体特征。
- 画面：前中后景、机位、商品位置、场景、道具、灯光、材质、阴影和反射。
- 视觉系统：共享配色、背景、字体、CTA、版式密度与商品渲染规则。
- 图内文字：目标语言、逐字内容、位置与层级。
- 物理规则：商品实际工作方式和禁止出现的不可能结构。
- 输出要求：一张完成度高的商业图片，不含 UI 外框、解释文字或水印。

`qualityChecklist` 只能包含生成后可检查的项目，例如“主商品结构与主图一致”，不能包含“模型已经充分思考”一类不可观察断言。

