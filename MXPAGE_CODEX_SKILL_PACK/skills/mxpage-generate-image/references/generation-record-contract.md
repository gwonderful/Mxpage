# 生成记录契约

每个图片版本旁保存同名 JSON：

```json
{
  "sectionId": "hero-01",
  "version": 1,
  "imagePath": "outputs/hero-01/v001.png",
  "promptPath": "prompts/hero-01.json",
  "referenceImages": ["assets/main/product.png"],
  "aspectRatio": "1:1",
  "generationMode": "codex-built-in-imagegen",
  "status": "generated",
  "createdAt": "ISO-8601"
}
```

`outputs/index.json`：

```json
{
  "sections": {
    "hero-01": {
      "currentVersion": 1,
      "currentImagePath": "outputs/hero-01/v001.png",
      "reviewStatus": "pending"
    }
  }
}
```

版本号从现有最大版本加一。图片扩展名沿用生成结果实际格式，不伪装格式。
