import { LaddersData } from "./ladders-data";

/**
 * Removes leftovers from interrupted or failed test runs.
 *
 * Rows created by the suites are named with a recognisable prefix, so anything
 * matching is safe to delete. Run it whenever a run is interrupted, otherwise
 * leftover teams and members accumulate in the real database.
 */
const pattern = new RegExp(process.argv[2] ?? "^(E2E|Probe|ZZ)");

const data = new LaddersData();

const before = {
  members: await data.listMembers(),
  teams: await data.listTeams(),
};

console.log("Antes:");
console.log(
  "  miembros:",
  before.members.map((m) => m.name),
);
console.log(
  "  equipos: ",
  before.teams.map((t) => `${t.name} (default=${t.is_default})`),
);

const removed = await data.removeMatching(pattern);

console.log(
  `\nBorrados: ${removed.members} miembros, ${removed.teams} equipos (patrón ${pattern})`,
);

const after = {
  members: await data.listMembers(),
  teams: await data.listTeams(),
};

console.log("\nDespués:");
console.log(
  "  miembros:",
  after.members.map((m) => m.name),
);
console.log(
  "  equipos: ",
  after.teams.map((t) => t.name),
);
