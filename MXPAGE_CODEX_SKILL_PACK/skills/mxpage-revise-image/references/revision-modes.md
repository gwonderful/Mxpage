# 修订模式

## repaint

适合氛围、场景、表现方式或卖点重心需要改变，但商品身份必须保持。明确“使用当前图片为底图”。

## enhance

适合清晰度、真实感、纹理、灯光、边缘和商业完成度问题。保持整体构图、商品、文案和视觉层级不变。

## translate

只替换所有用户可见文字为目标语言。保持商品、布局、配色、灯光、字体层级与视觉风格；不得添加新声明或保留意外双语重复。

## regenerate

适合商品类别、关键几何或整体构图已不可修复的版本。重新使用原 Prompt、主图和参考图生成，并加入 review 的关键失败项作为强禁止项。

## 修订记录

```json
{
  "sectionId": "hero-01",
  "version": 2,
  "sourceVersion": 1,
  "revisionMode": "repaint | enhance | translate | regenerate",
  "addressedIssues": ["string"],
  "preservedInvariants": ["string"],
  "editPrompt": "string",
  "imagePath": "outputs/hero-01/v002.png",
  "createdAt": "ISO-8601"
}
```

