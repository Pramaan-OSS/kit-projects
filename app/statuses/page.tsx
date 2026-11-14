"use client";
import { useState } from "react";
import { useResource } from "../../lib/pramaan/client";
import { Loading, send } from "../parts";
export default function Statuses() {
  const { data, error, loading, reload } = useResource<{
    statuses: { id: string; name: string }[];
    role: string;
  }>("/api/statuses");
  const [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  async function act(input: unknown) {
    setBusy(true);
    setMessage("");
    try {
      await send("/api/statuses", input);
      reload();
      setMessage(
        (input as { action: string }).action === "remove" ? "Status removed." : "Status saved.",
      );
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="workspace">
      <h1>Task statuses</h1>
      <p>Every project uses these statuses. A status used by a task cannot be removed.</p>
      <Loading error={error} loading={loading}>
        {data?.role === "owner" ? (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void act({ action: "add", name: new FormData(e.currentTarget).get("name") });
              }}
            >
              <label>
                New status
                <input name="name" required maxLength={40} />
              </label>
              <button type="submit" disabled={busy}>
                Add status
              </button>
            </form>
            {data.statuses.map((s) => (
              <form
                key={`${s.id}-${s.name}`}
                className="status-row"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act({
                    action: "rename",
                    id: s.id,
                    name: new FormData(e.currentTarget).get("name"),
                  });
                }}
              >
                <h2>{s.name}</h2>
                <label>
                  Status name
                  <input
                    name="name"
                    aria-label={`Name of ${s.name}`}
                    defaultValue={s.name}
                    required
                    maxLength={40}
                  />
                </label>
                <button disabled={busy} type="submit" aria-label={`Rename ${s.name}`}>
                  Rename
                </button>
                <button
                  disabled={busy}
                  type="button"
                  onClick={() => act({ action: "up", id: s.id })}
                  aria-label={`Move ${s.name} up`}
                >
                  Up
                </button>
                <button
                  disabled={busy}
                  type="button"
                  onClick={() => act({ action: "down", id: s.id })}
                  aria-label={`Move ${s.name} down`}
                >
                  Down
                </button>
                <button
                  disabled={busy}
                  type="button"
                  onClick={() => act({ action: "remove", id: s.id })}
                  aria-label={`Remove ${s.name}`}
                >
                  Remove
                </button>
              </form>
            ))}
          </>
        ) : (
          <p>Only the owner can edit statuses.</p>
        )}
      </Loading>
      <p role="status">{message}</p>
    </main>
  );
}
