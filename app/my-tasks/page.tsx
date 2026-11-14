import { TaskPanel } from "../task-panel";
export default function MyTasks() {
  return (
    <main className="workspace">
      <h1>My work</h1>
      <p>Tasks assigned to you across your projects.</p>
      <TaskPanel mine />
    </main>
  );
}
