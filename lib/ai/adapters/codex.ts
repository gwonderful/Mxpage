import { z } from "zod";
import { inspectCodex, runCodex } from "@/lib/ai/codex-app-server";
import type { ProviderAdapter, StructuredRequest, TextRequest, ImageGenerationRequest, ImageEditRequest } from "@/lib/ai/provider-client";

// Business schemas may contain transforms, optional fields and open dictionaries,
// which are not representable by Codex's strict structured-output subset.
const structuredEnvelopeSchema = z.object({ json: z.string() });

export class CodexAdapter implements ProviderAdapter {
  async testConnection() {
    await inspectCodex();
    return { ok: true, providerLabel: "本机 Codex · ChatGPT 登录" };
  }

  async listModels() {
    const status = await inspectCodex();
    return status.models.map((model) => ({ id: model.model, label: model.displayName || model.model, modalities: model.inputModalities }));
  }

  async generateText(input: TextRequest) {
    const result = await runCodex({ ...input, prompt: input.userPrompt });
    return { text: result.text };
  }

  async generateStructured<T>(input: StructuredRequest<T>) {
    const inputSchema = z.toJSONSchema(input.schema, { target: "draft-7", io: "input" });
    const result = await runCodex({ ...input,
      prompt: [input.userPrompt, "", "Transport format: return an object with a single 'json' string containing the JSON-encoded task result. The decoded value must match the following input schema. Do not include markdown fences. Local validation and transforms will be applied after decoding.", JSON.stringify(inputSchema)].join("\n"),
      outputSchema: z.toJSONSchema(structuredEnvelopeSchema, { target: "draft-7" }),
    });
    const { json: raw } = structuredEnvelopeSchema.parse(JSON.parse(result.text));
    return { parsed: input.schema.parse(JSON.parse(raw)), raw };
  }

  async generateImage(input: ImageGenerationRequest) {
    const result = await runCodex({ ...input, image: true, images: input.referenceImages,
      prompt: `Use native image generation to generate exactly one image. Required aspect ratio: ${input.aspectRatio || "1:1"}. Requested size: ${input.size || "auto"}. Preserve the identity of the referenced product.\n${input.prompt}` });
    return { b64Json: result.b64Json, revisedPrompt: result.revisedPrompt };
  }

  async editImage(input: ImageEditRequest) {
    if (input.mask) throw new Error("CODEX: 当前接入不支持精确蒙版编辑，请使用文字描述局部修改范围。");
    return this.generateImage({ ...input, referenceImages: [input.image, ...(input.referenceImages ?? [])],
      prompt: `Edit the FIRST reference image. Keep all unrequested elements unchanged. The other images are product references.\n${input.prompt}` });
  }
}
