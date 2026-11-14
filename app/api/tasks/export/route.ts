import { viewer } from "../../../../lib/projects/access";
import { exportCsv } from "../../../../lib/projects/csv";
import { handle } from "../../../../lib/roles/http";
export const dynamic = "force-dynamic";
export async function GET(r: Request) {
  return handle(
    async () =>
      new Response(await exportCsv(await viewer(r), new URL(r.url).searchParams), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": "attachment; filename=tasks.csv",
          "cache-control": "no-store",
        },
      }),
  );
}
