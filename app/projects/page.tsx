"use client";
import Link from "next/link";
import { useState } from "react";
import { useResource } from "../../lib/pramaan/client";
import { Loading, send } from "../parts";
export default function Projects() {
  const { data, error, loading, reload } = useResource<{
    projects: { id: string; name: string }[];
    role: string;
  }>("/api/projects");
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <main className="workspace">
      <p className="eyebrow">Team workspace</p>
      <h1>Projects</h1>
      <Loading error={error} loading={loading}>
        {data?.role !== "guest" && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              setBusy(true);
              try {
                await send("/api/projects", { name: new FormData(form).get("name") });
                form.reset();
                reload();
                setMessage("Project created.");
              } catch (e) {
                setMessage((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Project name
              <input name="name" required maxLength={120} />
            </label>
            <button disabled={busy} type="submit">
              Create project
            </button>
          </form>
        )}
        <div className="project-grid">
          {data?.projects.map((p) => (
            <article className="project-card" key={p.id}>
              <h2>
                <Link href={`/projects/${p.id}`}>{p.name}</Link>
              </h2>
              <p>Board, tasks and team comments</p>
            </article>
          ))}
        </div>
        {data?.projects.length === 0 && <p>No projects yet.</p>}
      </Loading>
      <p role="status">{message}</p>
    </main>
  );
}
