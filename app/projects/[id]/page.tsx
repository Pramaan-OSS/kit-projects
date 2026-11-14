"use client";
import { use, useState } from "react";
import { useResource } from "../../../lib/pramaan/client";
import { Loading, send } from "../../parts";
import { TaskPanel } from "../../task-panel";
export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params),
    { data, error, loading, reload } = useResource<{
      project: { id: string; name: string };
      comments: { id: string; body: string; author: string }[];
    }>(`/api/projects/${id}`);
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="workspace">
      <Loading error={error} loading={loading}>
        {data && (
          <>
            <p className="eyebrow">Project workspace</p>
            <h1>{data.project.name}</h1>
            <TaskPanel projectId={id} />
            <section>
              <h2>Project comments</h2>
              {data.comments.map((c) => (
                <article className="comment" key={c.id}>
                  <strong>{c.author}</strong>
                  <p>{c.body}</p>
                </article>
              ))}
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  setBusy(true);
                  try {
                    await send(`/api/projects/${id}`, { body: new FormData(form).get("body") });
                    form.reset();
                    reload();
                    setMessage("Comment posted.");
                  } catch (e) {
                    setMessage((e as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <label>
                  Comment
                  <textarea name="body" required maxLength={4000} />
                </label>
                <button type="submit" disabled={busy}>
                  Post comment
                </button>
              </form>
              <p role="status">{message}</p>
            </section>
          </>
        )}
      </Loading>
    </main>
  );
}
