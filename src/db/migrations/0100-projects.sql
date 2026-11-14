ALTER TABLE app_users ADD CONSTRAINT projects_account_roles CHECK (role IN ('owner','member','guest'));
CREATE TABLE workspaces (
 id uuid PRIMARY KEY, owner_id uuid NOT NULL UNIQUE REFERENCES app_users(id), name text NOT NULL DEFAULT 'Our team'
);
CREATE TABLE workspace_members (
 workspace_id uuid NOT NULL REFERENCES workspaces(id), user_id uuid NOT NULL REFERENCES app_users(id),
 role text NOT NULL CHECK(role IN ('owner','member','guest')), PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE project_statuses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 40), position integer NOT NULL,
 UNIQUE(workspace_id,name), UNIQUE(workspace_id,id)
);
CREATE TABLE projects (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES workspaces(id),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 120), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,id)
);
CREATE TABLE project_members (
 workspace_id uuid NOT NULL, project_id uuid NOT NULL, user_id uuid NOT NULL,
 PRIMARY KEY(project_id,user_id),
 FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
 FOREIGN KEY(workspace_id,user_id) REFERENCES workspace_members(workspace_id,user_id)
);
CREATE TABLE project_tasks (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, project_id uuid NOT NULL,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 240), notes text NOT NULL DEFAULT '' CHECK(length(notes)<=4000),
 assignee_id uuid, due_on date, priority text NOT NULL DEFAULT 'Normal' CHECK(priority IN ('Low','Normal','High')),
 status_id uuid NOT NULL, position integer NOT NULL, revision integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id),
 FOREIGN KEY(workspace_id,status_id) REFERENCES project_statuses(workspace_id,id) ON DELETE RESTRICT,
 FOREIGN KEY(workspace_id,assignee_id) REFERENCES workspace_members(workspace_id,user_id)
);
CREATE INDEX project_tasks_board ON project_tasks(project_id,status_id,position,id);
CREATE INDEX project_tasks_assignee ON project_tasks(workspace_id,assignee_id,due_on);
CREATE TABLE project_comments (
 id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES projects(id), author_id uuid NOT NULL REFERENCES app_users(id),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 4000), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX project_comments_project ON project_comments(project_id,created_at,id);
CREATE TABLE project_invites (
 id uuid PRIMARY KEY, token_hash text NOT NULL UNIQUE, email text NOT NULL, workspace_id uuid NOT NULL REFERENCES workspaces(id),
 role text NOT NULL CHECK(role IN ('member','guest')), project_id uuid,
 invited_by uuid NOT NULL REFERENCES app_users(id), emailed boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL, used_at timestamptz,
 FOREIGN KEY(workspace_id,project_id) REFERENCES projects(workspace_id,id), CHECK((role='guest')=(project_id IS NOT NULL))
);
CREATE UNIQUE INDEX project_invites_active ON project_invites(workspace_id,email) WHERE used_at IS NULL;
CREATE TABLE task_attachments (
 id uuid PRIMARY KEY, task_id uuid NOT NULL REFERENCES project_tasks(id), name text NOT NULL,
 size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 1 AND 10485760), uploaded_by uuid NOT NULL REFERENCES app_users(id),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX task_attachments_task ON task_attachments(task_id);
