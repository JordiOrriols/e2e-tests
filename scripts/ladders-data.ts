import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Direct access to the ladders Supabase data for test setup and cleanup.
 *
 * The suites drive the UI for the behaviour under test, but seeding and tearing
 * down rows over PostgREST is far faster and deterministic. Requests use the
 * signed-in test user's access token, so row level security applies exactly as
 * it does in the app: only that user's own rows are reachable.
 */

const LAD_DIR = resolve(import.meta.dirname, "../../ladders");
const STATE_PATH = resolve(
  import.meta.dirname,
  "../auth/ladders-storage-state.json",
);

export type AppEnv = Record<string, string | undefined>;

export function readAppEnv(): AppEnv {
  const env: AppEnv = {};
  for (const line of readFileSync(resolve(LAD_DIR, ".env"), "utf8").split(
    "\n",
  )) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match?.[1]) env[match[1]] = match[2];
  }
  return env;
}

export type Session = { url: string; key: string; token: string };

/**
 * Builds a client from the app env plus a signed-in session.
 *
 * The state path is a parameter so the same client can act as either test user,
 * which is what proves the row level security rather than just the UI.
 */
export function session(statePath: string = STATE_PATH): Session {
  const env = readAppEnv();
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new Error(
      "ladders/.env is missing the Supabase URL or publishable key",
    );

  const state = JSON.parse(readFileSync(statePath, "utf8")) as {
    origins?: { localStorage?: { name: string; value: string }[] }[];
  };
  const raw = state.origins?.[0]?.localStorage?.find((entry) =>
    entry.name.startsWith("sb-"),
  )?.value;
  if (!raw) throw new Error(`No Supabase session found in ${statePath}`);

  const token = (JSON.parse(raw) as { access_token?: string }).access_token;
  if (!token)
    throw new Error("The stored Supabase session has no access token");

  return { url, key, token };
}

export type MemberRow = {
  id: string;
  name: string;
  role: string;
  team_id: string | null;
  self_token: string;
  peer_token: string;
  view_token: string;
  view_enabled: boolean;
  template_id: string | null;
};

export type TeamRow = {
  id: string;
  name: string;
  is_default: boolean;
  owner_id: string;
  workspace_id: string;
};

export type WorkspaceRow = { id: string; name: string };

export type WorkspaceShareRow = {
  user_id: string;
  email: string;
  app: string;
  access_level: "viewer" | "editor";
};

/** The account a Supabase access token belongs to (the JWT subject). */
function tokenSubject(token: string): string {
  const payload = token.split(".")[1] ?? "";
  return (
    JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      sub: string;
    }
  ).sub;
}

export type EvaluationRow = {
  id: string;
  member_id: string;
  kind: "manager" | "self" | "peer";
  status: "draft" | "published";
  author_name: string | null;
  current_levels: Record<string, number> | null;
  goal_levels: Record<string, number> | null;
  comments: Record<string, string> | null;
  created_at: string;
};

/** What a version looks like when it is written straight through the API. */
export type EvaluationInput = {
  kind: "manager" | "self" | "peer";
  status?: "draft" | "published";
  authorName?: string | null;
  currentLevels?: Record<string, number>;
  goalLevels?: Record<string, number>;
  comments?: Record<string, string>;
  createdAt?: string;
};

export type GoalRow = {
  id: string;
  member_id: string;
  title: string;
  description: string;
  due_date: string | null;
  progress: number;
  comments: unknown[];
};

/** Short, quotable form of an error for failure messages. */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").slice(0, 160);
}

export class LaddersData {
  private readonly url: string;
  private readonly key: string;
  private readonly token: string;
  private readonly createdMembers = new Set<string>();
  private readonly createdTeams = new Set<string>();
  private readonly createdEvaluations = new Set<string>();
  private readonly createdWorkspaces = new Set<string>();
  private mainWorkspaceId: Promise<string> | null = null;

  constructor(statePath?: string) {
    const s = session(statePath);
    this.url = s.url;
    this.key = s.key;
    this.token = s.token;
  }

  private async request<T>(
    path: string,
    init: RequestInit & { prefer?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      apikey: this.key,
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
    };
    if (init.prefer) headers.Prefer = init.prefer;

    const response = await fetch(`${this.url}/rest/v1/${path}`, {
      ...init,
      headers,
    });
    if (!response.ok) {
      throw new Error(
        `${init.method ?? "GET"} ${path} failed (${response.status}): ${await response.text()}`,
      );
    }
    const body = await response.text();
    return (body ? JSON.parse(body) : null) as T;
  }

  listMembers(): Promise<MemberRow[]> {
    return this.request<MemberRow[]>("members?select=*&order=created_at.desc");
  }

  async member(id: string): Promise<MemberRow | undefined> {
    const rows = await this.request<MemberRow[]>(
      `members?id=eq.${id}&select=*`,
    );
    return rows[0];
  }

  /** Updates a member. Throws when row level security refuses the caller. */
  async patchMember(
    id: string,
    changes: Partial<Pick<MemberRow, "name" | "role">>,
  ): Promise<void> {
    await this.request(`members?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify(changes),
    });
  }

  listTeams(): Promise<TeamRow[]> {
    return this.request<TeamRow[]>("teams?select=*&order=created_at.desc");
  }

  async createMember(input: {
    name: string;
    role?: string;
    teamId?: string | null;
  }) {
    const rows = await this.request<MemberRow[]>("members", {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify({
        name: input.name,
        role: input.role ?? "",
        team_id: input.teamId ?? null,
      }),
    });
    this.createdMembers.add(rows[0].id);
    return rows[0];
  }

  async deleteMember(id: string): Promise<void> {
    await this.request(`members?id=eq.${id}`, { method: "DELETE" });
  }

  /**
   * The workspace holding this account's default team, which is the one the
   * app opens (fixtures pin it, so other test workspaces cannot take its place).
   */
  mainWorkspace(): Promise<string> {
    this.mainWorkspaceId ??= this.request<TeamRow[]>(
      `teams?is_default=eq.true&owner_id=eq.${tokenSubject(this.token)}&select=*`,
    ).then((rows) => {
      if (!rows[0]) throw new Error("The test account has no default team");
      return rows[0].workspace_id;
    });
    return this.mainWorkspaceId;
  }

  /**
   * Teams are created through the create_team RPC, inside a workspace the
   * caller owns (the main one unless told otherwise).
   *
   * A direct insert trips the RLS check because the row level policy compares
   * owner_id against auth.uid() before the column default is applied. The RPC is
   * security definer and is the path the app itself uses.
   */
  async createTeam(name: string, workspaceId?: string) {
    const team = await this.request<TeamRow>("rpc/create_team", {
      method: "POST",
      body: JSON.stringify({
        p_name: name,
        p_workspace: workspaceId ?? (await this.mainWorkspace()),
      }),
    });
    this.createdTeams.add(team.id);
    return team;
  }

  /** Registers a team created through the UI so cleanup removes it too. */
  async adoptTeam(name: string): Promise<void> {
    const team = (await this.listTeams()).find((t) => t.name === name);
    if (!team) throw new Error(`Team ${name} was not created`);
    this.createdTeams.add(team.id);
  }

  async deleteTeam(id: string): Promise<void> {
    await this.request(`teams?id=eq.${id}`, { method: "DELETE" });
  }

  /* Workspaces and sharing: team access comes from the workspace share. */

  async createWorkspace(name: string): Promise<WorkspaceRow> {
    const workspace = await this.request<WorkspaceRow>("rpc/create_workspace", {
      method: "POST",
      body: JSON.stringify({ workspace_name: name }),
    });
    this.createdWorkspaces.add(workspace.id);
    return workspace;
  }

  /** Registers a workspace created through the UI so cleanup removes it too. */
  trackWorkspace(workspace: { id: string }): void {
    this.createdWorkspaces.add(workspace.id);
  }

  listWorkspaces(): Promise<(WorkspaceRow & { access_level: string })[]> {
    return this.request("rpc/list_workspaces", {
      method: "POST",
      body: JSON.stringify({ app_name: "ladders" }),
    });
  }

  listShares(workspaceId: string): Promise<WorkspaceShareRow[]> {
    return this.request<WorkspaceShareRow[]>("rpc/list_workspace_shares", {
      method: "POST",
      body: JSON.stringify({ workspace: workspaceId }),
    });
  }

  shareWorkspace(
    workspaceId: string,
    email: string,
    access: "viewer" | "editor",
  ) {
    return this.request("rpc/share_workspace", {
      method: "POST",
      body: JSON.stringify({
        workspace: workspaceId,
        account_email: email,
        app_name: "ladders",
        access,
      }),
    });
  }

  removeShare(workspaceId: string, userId: string) {
    return this.request("rpc/remove_workspace_share", {
      method: "POST",
      body: JSON.stringify({
        workspace: workspaceId,
        account: userId,
        app_name: "ladders",
      }),
    });
  }

  listEvaluations(memberId: string): Promise<EvaluationRow[]> {
    return this.request<EvaluationRow[]>(
      `evaluations?member_id=eq.${memberId}&select=*&order=created_at.desc`,
    );
  }

  /**
   * Writes a version directly, which is how a test sets up a state the UI would
   * need several steps to reach. The level and comment columns are not nullable
   * and the app stores an empty map rather than null, so that is what goes in.
   */
  async createEvaluation(
    memberId: string,
    input: EvaluationInput,
  ): Promise<EvaluationRow> {
    const rows = await this.request<EvaluationRow[]>("evaluations", {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify({
        member_id: memberId,
        kind: input.kind,
        status: input.status ?? "draft",
        author_name: input.authorName ?? null,
        current_levels: input.currentLevels ?? {},
        goal_levels: input.goalLevels ?? {},
        comments: input.comments ?? {},
        ...(input.createdAt ? { created_at: input.createdAt } : {}),
      }),
    });
    // An insert that returned nothing would otherwise be tracked as the string
    // "undefined" and fail again, later, during cleanup.
    const row = rows[0];
    if (!row?.id) throw new Error("the evaluation insert returned no row");
    this.createdEvaluations.add(row.id);
    return row;
  }

  async updateEvaluationStatus(
    id: string,
    status: "draft" | "published",
  ): Promise<void> {
    await this.request(`evaluations?id=eq.${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
  }

  /**
   * Creates a goal without going through the form.
   *
   * The payload is exactly the one the app writes, and that is deliberate: the
   * live project grants INSERT on smart_goals column by column, so naming
   * `comments` in the body is refused outright with "permission denied for table
   * smart_goals" even though reading and updating the column both work.
   */
  async createGoal(input: {
    memberId: string;
    title: string;
    description?: string;
    dueDate?: string | null;
  }): Promise<GoalRow> {
    const rows = await this.request<GoalRow[]>("smart_goals", {
      method: "POST",
      prefer: "return=representation",
      body: JSON.stringify({
        member_id: input.memberId,
        title: input.title,
        description: input.description ?? "",
        due_date: input.dueDate ?? null,
        progress: 0,
      }),
    });
    const row = rows[0];
    if (!row?.id) throw new Error("the goal insert returned no row");
    return row;
  }

  listGoals(memberId: string): Promise<GoalRow[]> {
    return this.request<GoalRow[]>(
      `smart_goals?member_id=eq.${memberId}&select=*&order=created_at`,
    );
  }

  async appendGoalComment(goalId: string, text: string): Promise<GoalRow> {
    return this.request<GoalRow>("rpc/append_goal_comment", {
      method: "POST",
      body: JSON.stringify({ p_id: goalId, p_text: text }),
    });
  }

  /** Puts the member on a seniority template, or takes it off them with null. */
  async setTemplate(
    memberId: string,
    templateId: string | null,
  ): Promise<void> {
    await this.request(`members?id=eq.${memberId}`, {
      method: "PATCH",
      body: JSON.stringify({ template_id: templateId }),
    });
  }

  /** Renames a goal, which is what an update of an untouched goal looks like. */
  async renameGoal(goalId: string, title: string): Promise<void> {
    await this.request(`smart_goals?id=eq.${goalId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
  }

  /**
   * Replaces the comment list of a goal outright, which is the one edit the
   * database is not supposed to allow. Note that the live project never gets far
   * enough to answer: it grants UPDATE on smart_goals column by column and
   * leaves out comments, so the refusal is a permission error rather than the
   * immutable trigger. Either way the thread cannot be rewritten.
   */
  async replaceGoalComments(
    goalId: string,
    comments: unknown[],
  ): Promise<void> {
    await this.request(`smart_goals?id=eq.${goalId}`, {
      method: "PATCH",
      body: JSON.stringify({ comments }),
    });
  }

  async goal(id: string): Promise<GoalRow | undefined> {
    const rows = await this.request<GoalRow[]>(
      `smart_goals?id=eq.${id}&select=*`,
    );
    return rows[0];
  }

  async setViewEnabled(memberId: string, enabled: boolean): Promise<void> {
    await this.request(`members?id=eq.${memberId}`, {
      method: "PATCH",
      body: JSON.stringify({ view_enabled: enabled }),
    });
  }

  /**
   * Deletes exactly the rows this instance created, members before teams.
   *
   * Cleanup is intentionally id based rather than name based: the suites run
   * against a shared project and in parallel, so a blanket `E2E` prefix sweep
   * would delete rows another worker is still relying on.
   */
  /** Registers a row created through the UI so cleanup() still removes it. */
  trackMember(member: { id: string }): { id: string } {
    this.createdMembers.add(member.id);
    return member;
  }

  trackTeam(team: { id: string }): { id: string } {
    this.createdTeams.add(team.id);
    return team;
  }

  async cleanup(): Promise<{
    members: number;
    teams: number;
    failures: string[];
  }> {
    // Every row is attempted even after one fails. Aborting on the first error
    // used to leave every remaining row behind and report the run as clean,
    // which then showed up much later as a confusing unrelated failure.
    const failures: string[] = [];
    let members = 0;
    for (const id of this.createdMembers) {
      try {
        await this.deleteMember(id);
        members += 1;
      } catch (error) {
        failures.push(`member ${id}: ${describe(error)}`);
      }
    }
    for (const id of this.createdEvaluations) {
      try {
        await this.request(`evaluations?id=eq.${id}`, { method: "DELETE" });
      } catch (error) {
        failures.push(`evaluation ${id}: ${describe(error)}`);
      }
    }
    let teams = 0;
    for (const id of this.createdTeams) {
      try {
        await this.deleteTeam(id);
        teams += 1;
      } catch (error) {
        failures.push(`team ${id}: ${describe(error)}`);
      }
    }
    // A workspace can only go once its teams are gone.
    for (const id of this.createdWorkspaces) {
      try {
        await this.request(`workspaces?id=eq.${id}`, { method: "DELETE" });
      } catch (error) {
        failures.push(`workspace ${id}: ${describe(error)}`);
      }
    }
    this.createdMembers.clear();
    this.createdTeams.clear();
    this.createdWorkspaces.clear();
    this.createdEvaluations.clear();
    if (failures.length > 0) {
      throw new Error(
        `cleanup left ${failures.length} row(s) behind:\n  ${failures.join("\n  ")}`,
      );
    }
    return { members, teams, failures };
  }

  /** Bulk sweep by name, for manual recovery via scripts/cleanup-ladders-data.ts. */
  async removeMatching(
    pattern: RegExp,
  ): Promise<{ members: number; teams: number }> {
    const members = (await this.listMembers()).filter((m) =>
      pattern.test(m.name),
    );
    for (const member of members) await this.deleteMember(member.id);

    const teams = (await this.listTeams()).filter((t) => pattern.test(t.name));
    for (const team of teams) await this.deleteTeam(team.id);

    return { members: members.length, teams: teams.length };
  }
}
