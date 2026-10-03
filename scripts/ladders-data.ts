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

/** Builds a client from the app env plus the signed-in session. */
export function session(): Session {
  const env = readAppEnv();
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key)
    throw new Error(
      "ladders/.env is missing the Supabase URL or publishable key",
    );

  const state = JSON.parse(readFileSync(STATE_PATH, "utf8")) as {
    origins?: { localStorage?: { name: string; value: string }[] }[];
  };
  const raw = state.origins?.[0]?.localStorage?.find((entry) =>
    entry.name.startsWith("sb-"),
  )?.value;
  if (!raw) throw new Error(`No Supabase session found in ${STATE_PATH}`);

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
};

export type TeamRow = { id: string; name: string; is_default: boolean };

export type EvaluationRow = {
  id: string;
  member_id: string;
  kind: "manager" | "self" | "peer";
  status: "draft" | "published";
  author_name: string | null;
  current_levels: Record<string, number> | null;
  goal_levels: Record<string, number> | null;
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

export class LaddersData {
  private readonly url: string;
  private readonly key: string;
  private readonly token: string;
  private readonly createdMembers = new Set<string>();
  private readonly createdTeams = new Set<string>();

  constructor() {
    const s = session();
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
   * Teams are created through the create_team RPC.
   *
   * A direct insert trips the RLS check because the row level policy compares
   * owner_id against auth.uid() before the column default is applied. The RPC is
   * security definer and is the path the app itself uses.
   */
  async createTeam(name: string) {
    const team = await this.request<TeamRow>("rpc/create_team", {
      method: "POST",
      body: JSON.stringify({ p_name: name }),
    });
    this.createdTeams.add(team.id);
    return team;
  }

  async deleteTeam(id: string): Promise<void> {
    await this.request(`teams?id=eq.${id}`, { method: "DELETE" });
  }

  listEvaluations(memberId: string): Promise<EvaluationRow[]> {
    return this.request<EvaluationRow[]>(
      `evaluations?member_id=eq.${memberId}&select=*&order=created_at.desc`,
    );
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

  async cleanup(): Promise<{ members: number; teams: number }> {
    let members = 0;
    for (const id of this.createdMembers) {
      await this.deleteMember(id);
      members += 1;
    }
    let teams = 0;
    for (const id of this.createdTeams) {
      await this.deleteTeam(id);
      teams += 1;
    }
    this.createdMembers.clear();
    this.createdTeams.clear();
    return { members, teams };
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
