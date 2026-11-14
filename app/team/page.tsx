"use client";
import { useState } from "react";
import { useResource } from "../../lib/pramaan/client";
import { InviteNotice, Loading, send } from "../parts";
export default function Team() {
  const { data, error, loading } = useResource<{
    people: { id: string; email: string; role: string }[];
    projects: { id: string; name: string }[];
  }>("/api/team");
  const [role, setRole] = useState("member"),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [invite, setInvite] = useState<{ email: string; delivery: string; link?: string }>();
  return (
    <main className="workspace">
      <h1>Team and guests</h1>
      <p>Members work across the team. A guest sees and comments on just the project you choose.</p>
      <Loading error={error} loading={loading}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            setBusy(true);
            setInvite(undefined);
            try {
              setInvite(
                await send("/api/team", {
                  email: f.get("email"),
                  role,
                  projectId: f.get("project"),
                }),
              );
              setMessage("");
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            Invite email
            <input name="email" type="email" required />
          </label>
          <label>
            Invite role
            <select aria-label="Invite role" value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="member">Member</option>
              <option value="guest">Guest</option>
            </select>
          </label>
          {role === "guest" && (
            <label>
              Guest project
              <select aria-label="Guest project" name="project" required>
                <option value="">Choose a project</option>
                {data?.projects.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="submit" disabled={busy}>
            Invite person
          </button>
        </form>
        {invite && <InviteNotice invite={invite} />}
        <h2>Team members</h2>
        <ul>
          {data?.people.map((p) => (
            <li key={p.id}>
              {p.email} · {p.role}
            </li>
          ))}
        </ul>
      </Loading>
      <p role="status">{message}</p>
    </main>
  );
}
