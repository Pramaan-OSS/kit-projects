import { AccountError } from "../../../lib/accounts";
import { emailDoor } from "../../../lib/email";
import { owner, project, viewer } from "../../../lib/projects/access";
import { listProjects, people } from "../../../lib/projects/data";
import { createInvite } from "../../../lib/projects/invites";
import { appOrigin } from "../../../lib/projects/origin";
import { handle, readBody, reply } from "../../../lib/roles/http";
export const dynamic = "force-dynamic";
export async function GET(r: Request) {
  return handle(async () => {
    const v = await viewer(r);
    owner(v);
    return reply({ people: await people(v), projects: await listProjects(v) });
  });
}
export async function POST(r: Request) {
  return handle(async () => {
    const v = await viewer(r);
    owner(v);
    const b = await readBody(r);
    if (b.role !== "member" && b.role !== "guest")
      throw new AccountError(400, "Choose member or guest.");
    const pid = b.role === "guest" ? (await project(v, b.projectId)).id : null;
    return reply(
      await createInvite(
        emailDoor,
        {
          email: b.email,
          role: b.role,
          projectId: pid,
          workspaceId: v.workspaceId,
          invitedBy: v.user.id,
        },
        appOrigin(r),
        "Team projects",
      ),
      201,
    );
  });
}
