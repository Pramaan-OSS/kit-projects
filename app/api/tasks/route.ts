import { AccountError } from "../../../lib/accounts";
import { viewer } from "../../../lib/projects/access";
import { importCsv } from "../../../lib/projects/csv";
import { listTasks, moveTask, saveTask } from "../../../lib/projects/data";
import { handle, readBody, reply } from "../../../lib/roles/http";
export const dynamic = "force-dynamic";
export async function GET(r: Request) {
  return handle(async () =>
    reply({ tasks: await listTasks(await viewer(r), new URL(r.url).searchParams) }),
  );
}
export async function POST(r: Request) {
  return handle(async () => {
    const v = await viewer(r),
      b = await readBody(r);
    if (b.action === "save") return reply(await saveTask(v, b));
    if (b.action === "move") {
      await moveTask(v, b);
      return reply({ saved: true });
    }
    if (b.action === "import") return reply(await importCsv(v, b.projectId, b.csv));
    throw new AccountError(400, "Choose a task action.");
  });
}
