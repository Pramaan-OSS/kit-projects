import { viewer } from "../../../lib/projects/access";
import { statusAction, statuses } from "../../../lib/projects/data";
import { handle, readBody, reply } from "../../../lib/roles/http";
export const dynamic = "force-dynamic";
export async function GET(r: Request) {
  return handle(async () => {
    const v = await viewer(r);
    return reply({ statuses: await statuses(v), role: v.role });
  });
}
export async function POST(r: Request) {
  return handle(async () => {
    const v = await viewer(r);
    await statusAction(v, await readBody(r));
    return reply({ saved: true });
  });
}
