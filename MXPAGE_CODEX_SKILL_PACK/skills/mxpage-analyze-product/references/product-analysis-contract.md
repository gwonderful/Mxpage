# 商品分析契约

只输出以下业务字段；不得把 Prompt、推理过程或 Markdown 写入 JSON。

```json
{
  "productName": "string",
  "category": "string",
  "subcategory": "string",
  "material": "string",
  "color": "string",
  "styleTags": ["string"],
  "targetAudience": ["string"],
  "usageScenarios": ["string"],
  "coreSellingPoints": ["string"],
  "differentiationPoints": ["string"],
  "userConcerns": ["string"],
  "recommendedFocusPoints": ["string"],
  "additionalInformation": "string",
  "generationRequirements": "string",
  "suggestedSectionPlan": [
    {
      "type": "hero | selling_points | scenario | detail_closeup | specs | material | comparison | gift_scene | brand_trust | summary",
      "title": "string",
      "goal": "string"
    }
  ]
}
```

## 分析规则

- 先识别准确对象、用途、结构、重复部件数量和不能误认成的类别。
- 卖点必须能被素材或用户事实支持；营销表达可以提炼，技术参数不能虚构。
- `additionalInformation` 汇总商品几何、使用方式、机械/物理约束，以及待补充参数。
- `generationRequirements` 原样保留用户要求，并将明显冲突标记出来。
- `suggestedSectionPlan` 至少 6 项，各项职责不同并符合真实商品类别。

