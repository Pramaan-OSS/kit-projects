import { viewer } from "../../../../lib/projects/access";
import { download } from "../../../../lib/projects/files";
import { handle } from "../../../../lib/roles/http";
export const dynamic = "force-dynamic";
export async function GET(r: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const f = await download(await viewer(r), (await params).id);
    return new Response(new Uint8Array(f.body), {
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
      },
    });
  });
}
