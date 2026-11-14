import { project, viewer } from "../../../../lib/projects/access";
import { comment, comments } from "../../../../lib/projects/data";
import { handle, readBody, reply } from "../../../../lib/roles/http";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };
export async function GET(r: Request, { params }: P) {
  return handle(async () => {
    const v = await viewer(r),
      { id } = await params;
    return reply({ project: await project(v, id), comments: await comments(v, id) });
  });
}
export async function POST(r: Request, { params }: P) {
  return handle(async () => {
    const v = await viewer(r),
      b = await readBody(r);
    await comment(v, (await params).id, b.body);
    return reply({ saved: true }, 201);
  });
}
