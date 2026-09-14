import { buildImageArchive, IncompleteExportError } from "@/lib/services/export-service";
import { fail, handleRouteError } from "@/lib/utils/route";

export async function GET(_request: Request, context: { params: { id: string } }) {
  try {
    const stream = await buildImageArchive(context.params.id);
    return new Response(stream as never, {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${context.params.id}-detail-page-images.zip"`,
      },
    });
  } catch (error) {
    if (error instanceof IncompleteExportError) {
      return fail("EXPORT_INCOMPLETE", error.message, error.details, 409);
    }
    return handleRouteError(error);
  }
}
