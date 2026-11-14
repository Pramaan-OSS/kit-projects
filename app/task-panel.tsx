"use client";
import Link from "next/link";
import { useState } from "react";
import { api, useResource } from "../lib/pramaan/client";
import { Loading, send } from "./parts";

type Status = { id: string; name: string };
type Person = { id: string; email: string };
type Task = {
  id: string;
  project_id: string;
  project: string;
  title: string;
  notes: string;
  status_id: string;
  status: string;
  assignee_id: string | null;
  assignee: string;
  due_on: string | null;
  priority: string;
  revision: number;
};
type Info = { statuses: Status[]; people: Person[]; role: string };
const day = (value: string | null) => (value ? value.slice(0, 10) : "");
export function TaskPanel({ projectId, mine = false }: { projectId?: string; mine?: boolean }) {
  const info = useResource<Info>("/api/projects");
  const [view, setView] = useState<"board" | "list">(mine ? "list" : "board");
  const [assignee, setAssignee] = useState(""),
    [status, setStatus] = useState(""),
    [due, setDue] = useState("");
  const query = new URLSearchParams({
    ...(projectId ? { project: projectId } : {}),
    ...(mine ? { mine: "1" } : {}),
    ...(assignee ? { assignee } : {}),
    ...(status ? { status } : {}),
    ...(due ? { due } : {}),
  }).toString();
  const { data, error, loading, reload } = useResource<{ tasks: Task[] }>(`/api/tasks?${query}`);
  const [editing, setEditing] = useState<Task | "new">(),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [grabbed, setGrabbed] = useState<Task>();
  const [selected, setSelected] = useState<Task>(),
    [files, setFiles] = useState<{ id: string; name: string }[]>([]);
  const statuses = info.data?.statuses ?? [],
    people = info.data?.people ?? [],
    tasks = data?.tasks ?? [];
  const canEdit = info.data?.role === "owner" || info.data?.role === "member";
  async function change(body: unknown) {
    setBusy(true);
    setMessage("");
    try {
      const r = await send<{ notice?: string }>("/api/tasks", body);
      reload();
      setMessage(r.notice ?? "Saved.");
      return true;
    } catch (e) {
      setMessage((e as Error).message);
      reload();
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function move(t: Task, sid: string, beforeId?: string) {
    await change({
      action: "move",
      id: t.id,
      projectId: t.project_id,
      statusId: sid,
      revision: t.revision,
      beforeId,
    });
    setGrabbed(undefined);
  }
  async function openFiles(t: Task) {
    setSelected(t);
    setMessage("");
    try {
      const r = await api<{ files: { id: string; name: string }[] }>(`/api/tasks/${t.id}/files`);
      setFiles(r.files);
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  function card(t: Task) {
    return (
      <article
        className="task-card"
        draggable={canEdit && !busy}
        onDragStart={(e) => {
          setGrabbed(t);
          e.dataTransfer.setData("text/plain", t.id);
        }}
        onDragEnd={() => setGrabbed(undefined)}
        key={t.id}
        data-task={t.title}
      >
        <h3>{t.title}</h3>
        <p>{t.notes}</p>
        <p>
          {t.priority} priority · {t.assignee_id ? t.assignee : "Unassigned"}
          {t.due_on ? ` · Due ${day(t.due_on)}` : ""}
        </p>
        {!projectId && <Link href={`/projects/${t.project_id}`}>{t.project}</Link>}
        {canEdit && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => setEditing(t)}
              aria-label={`Edit ${t.title}`}
            >
              Edit
            </button>
            <label>
              Move {t.title}
              <select
                aria-label={`Move ${t.title}`}
                value={t.status_id}
                disabled={busy}
                onChange={(e) => move(t, e.target.value)}
              >
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const prev = tasks.filter((x) => x.status_id === t.status_id);
                const i = prev.findIndex((x) => x.id === t.id);
                if (i > 0) void move(t, t.status_id, prev[i - 1]?.id);
              }}
            >
              Move up
            </button>
          </>
        )}
        <button type="button" onClick={() => openFiles(t)}>
          Attachments for {t.title}
        </button>
      </article>
    );
  }
  return (
    <section>
      <h2>{mine ? "My tasks" : "Tasks"}</h2>
      <Loading loading={info.loading} error={info.error}>
        <div className="toolbar">
          <button type="button" aria-pressed={view === "board"} onClick={() => setView("board")}>
            Board
          </button>
          <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>
            List
          </button>
          {canEdit && projectId && (
            <button type="button" onClick={() => setEditing("new")}>
              Add task
            </button>
          )}
          <a href={`/api/tasks/export?${query}`}>Export tasks CSV</a>
        </div>
        <div className="filters">
          <label>
            Assignee filter
            <select
              aria-label="Assignee filter"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
            >
              <option value="">All assignees</option>
              {people.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.email}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status filter
            <select
              aria-label="Status filter"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">All statuses</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Due filter
            <select aria-label="Due filter" value={due} onChange={(e) => setDue(e.target.value)}>
              <option value="">Any date</option>
              <option value="overdue">Overdue</option>
              <option value="today">Today</option>
              <option value="upcoming">Upcoming</option>
              <option value="none">No due date</option>
            </select>
          </label>
        </div>
        {editing && (
          <form
            className="editor"
            key={editing === "new" ? "new" : editing.id}
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const t = editing === "new" ? undefined : editing;
              const saved = await change({
                action: "save",
                id: t?.id,
                revision: t?.revision,
                projectId: t?.project_id ?? projectId,
                title: f.get("title"),
                notes: f.get("notes"),
                assigneeId: f.get("assignee"),
                dueOn: f.get("due"),
                priority: f.get("priority"),
                statusId: f.get("status"),
              });
              if (saved) setEditing(undefined);
            }}
          >
            <h3>{editing === "new" ? "New task" : "Edit task"}</h3>
            <label>
              Task title
              <input
                name="title"
                required
                maxLength={240}
                defaultValue={editing === "new" ? "" : editing.title}
              />
            </label>
            <label>
              Notes
              <textarea
                name="notes"
                maxLength={4000}
                defaultValue={editing === "new" ? "" : editing.notes}
              />
            </label>
            <label>
              Assignee
              <select
                aria-label="Assignee"
                name="assignee"
                defaultValue={editing === "new" ? "" : (editing.assignee_id ?? "")}
              >
                <option value="">Unassigned</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.email}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Due date
              <input
                name="due"
                type="date"
                defaultValue={editing === "new" ? "" : day(editing.due_on)}
              />
            </label>
            <label>
              Priority
              <select
                aria-label="Priority"
                name="priority"
                defaultValue={editing === "new" ? "Normal" : editing.priority}
              >
                <option>Low</option>
                <option>Normal</option>
                <option>High</option>
              </select>
            </label>
            <label>
              Task status
              <select
                aria-label="Task status"
                name="status"
                defaultValue={editing === "new" ? statuses[0]?.id : editing.status_id}
              >
                {statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={busy}>
              Save task
            </button>
            <button type="button" disabled={busy} onClick={() => setEditing(undefined)}>
              Cancel
            </button>
          </form>
        )}
        <Loading error={error} loading={loading}>
          <div className={view === "board" ? "board" : "task-list"}>
            {view === "board"
              ? statuses
                  .filter((s) => !status || s.id === status)
                  .map((s) => (
                    <section
                      className="board-column"
                      key={s.id}
                      aria-label={s.name}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        if (grabbed && !busy) void move(grabbed, s.id);
                      }}
                    >
                      <h3>
                        {s.name} <span>{tasks.filter((t) => t.status_id === s.id).length}</span>
                      </h3>
                      {tasks.filter((t) => t.status_id === s.id).map(card)}
                    </section>
                  ))
              : tasks.map(card)}
          </div>
          {tasks.length === 0 && <p>No tasks match these filters.</p>}
        </Loading>
        {canEdit && projectId && (
          <section>
            <h3>Import tasks</h3>
            <p>
              Use columns: Title, Notes, Assignee email, Due date, Priority, Status. Up to 100 tasks
              and 12 KB per file.
            </p>
            <label>
              Tasks CSV
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 12000) {
                    setMessage("Import at most 12 KB at once.");
                    return;
                  }
                  await change({ action: "import", projectId, csv: await file.text() });
                  e.target.value = "";
                }}
              />
            </label>
          </section>
        )}
        {selected && (
          <section className="editor">
            <h3>Attachments for {selected.title}</h3>
            <p>Files need the platform file storage module. Up to 10 MB per file.</p>
            <ul>
              {files.map((f) => (
                <li key={f.id}>
                  <a href={`/api/files/${f.id}`}>{f.name}</a>
                </li>
              ))}
            </ul>
            {canEdit && (
              <label>
                Task attachment
                <input
                  type="file"
                  disabled={busy}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    if (f.size > 10485760) {
                      setMessage("Files can be at most 10 MB.");
                      return;
                    }
                    setBusy(true);
                    try {
                      await api(`/api/tasks/${selected.id}/files`, {
                        method: "POST",
                        headers: {
                          "content-type": "application/octet-stream",
                          "x-file-name": f.name,
                        },
                        body: f,
                      });
                      await openFiles(selected);
                      setMessage("Attachment uploaded.");
                    } catch (e) {
                      setMessage((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </label>
            )}
            <button type="button" onClick={() => setSelected(undefined)}>
              Close attachments
            </button>
          </section>
        )}
      </Loading>
      <p role="status">{message}</p>
    </section>
  );
}
