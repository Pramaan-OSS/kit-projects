import { AccountError } from "../../../../../lib/accounts";
import { viewer } from "../../../../../lib/projects/access";
import { attachments, readFileBody, upload } from "../../../../../lib/projects/files";
import { appOrigin } from "../../../../../lib/projects/origin";
import { handle, reply } from "../../../../../lib/roles/http";
export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };
export async function GET(r: Request, { params }: P) {
  return handle(async () =>
    reply({ files: await attachments(await viewer(r), (await params).id) }),
  );
}
export async function POST(r: Request, { params }: P) {
  return handle(async () => {
    if (r.headers.get("origin") !== appOrigin(r))
      throw new AccountError(403, "Refresh this page and try again.");
    const v = await viewer(r);
    return reply(
      await upload(v, (await params).id, r.headers.get("x-file-name"), await readFileBody(r)),
      201,
    );
  });
}
