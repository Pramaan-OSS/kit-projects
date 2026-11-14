import { viewer } from "../../../lib/projects/access";
import { addProject, listProjects, people, statuses } from "../../../lib/projects/data";
import { handle, readBody, reply } from "../../../lib/roles/http";
export const dynamic = "force-dynamic";
export async function GET(r: Request) {
  return handle(async () => {
    const v = await viewer(r);
    return reply({
      projects: await listProjects(v),
      statuses: await statuses(v),
      people: await people(v),
      role: v.role,
      userId: v.user.id,
    });
  });
}
export async function POST(r: Request) {
  return handle(async () => {
    const v = await viewer(r);
    const b = await readBody(r);
    return reply(await addProject(v, b.name), 201);
  });
}
