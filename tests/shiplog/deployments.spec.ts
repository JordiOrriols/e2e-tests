import { test, expect, type BrowserContext } from "@playwright/test";
import {
  api,
  authenticatedPage,
  createWorkspace,
  removeWorkspace,
  selectWorkspace,
  signIn,
} from "../planner/planner-helpers";

test("manual deployment outcomes, historical backfills and rollbacks update only the reported environment version", async ({
  browser,
}) => {
  test.setTimeout(150_000);
  const owner = await signIn();
  const workspace = await createWorkspace(
    owner,
    `Shiplog deployments ${Date.now()}`,
  );
  const contexts: BrowserContext[] = [];
  try {
    const app = await api<{ id: string }>(
      owner,
      "rpc/shiplog_create_application",
      {
        method: "POST",
        body: JSON.stringify({
          workspace: workspace.id,
          application_name: "Website",
          application_slug: "website",
          application_platform: "web",
        }),
      },
    );
    const first = await api<{ id: string }>(
      owner,
      "rpc/shiplog_create_release",
      {
        method: "POST",
        body: JSON.stringify({
          input: {
            application_id: app!.id,
            version: "1.0.0",
            release_type: "minor",
            title: "Initial launch",
            internal_notes: "",
            public_notes: "Hello public",
          },
        }),
      },
    );
    const second = await api<{ id: string }>(
      owner,
      "rpc/shiplog_create_release",
      {
        method: "POST",
        body: JSON.stringify({
          input: {
            application_id: app!.id,
            version: "2.0.0",
            release_type: "major",
            title: "Second launch",
            internal_notes: "",
            public_notes: "",
          },
        }),
      },
    );
    const { page, context } = await authenticatedPage(
      browser,
      owner,
      "http://127.0.0.1:5178",
    );
    contexts.push(context);
    await selectWorkspace(page, workspace.name);
    await page.getByRole("link", { name: "Applications", exact: true }).click();
    await page
      .getByRole("button", { name: "Deployments", exact: true })
      .click();
    const production = page.getByRole("region", {
      name: "Production reported version",
      exact: true,
    });
    const staging = page.getByRole("region", {
      name: "Staging reported version",
      exact: true,
    });
    await expect(production).toContainText("Not recorded");
    await expect(staging).toContainText("Not recorded");
    const record = async (
      version: string,
      outcome: string,
      completed: string,
      build: string,
      environment = "Production",
      rollbackTarget?: string,
    ) => {
      await page
        .getByRole("button", { name: "Record deployment outcome", exact: true })
        .click();
      await page
        .getByLabel("Environment", { exact: true })
        .selectOption({ label: environment });
      await page
        .getByLabel("Release version (rollback source)", { exact: true })
        .selectOption(version);
      await page
        .getByLabel("Deployment outcome", { exact: true })
        .selectOption(outcome);
      if (rollbackTarget) {
        await page
          .getByLabel("Rollback target version", { exact: true })
          .selectOption(rollbackTarget);
        await page
          .getByLabel("Rollback reason", { exact: true })
          .fill("SECRET regression rollback");
      } else {
        await page
          .getByLabel("Deployment notes", { exact: true })
          .fill("SECRET deployment notes");
      }
      await page
        .getByLabel("Deployment started", { exact: true })
        .fill("2026-01-01T10:00");
      await page
        .getByLabel("Deployment completed", { exact: true })
        .fill(completed);
      await page
        .getByLabel("Commit or build reference", { exact: true })
        .fill(build);
      await page
        .getByLabel("Pipeline or report URL (HTTP/HTTPS)", { exact: true })
        .fill("https://ci.example.com/run/123");
      if (outcome === "failed")
        await page
          .getByLabel("Error details", { exact: true })
          .fill("SECRET upload failed");
      if (environment === "Production") {
        await expect(page.getByRole("status")).toContainText(
          "Production readiness warnings only",
        );
      }
      await page
        .getByRole("button", { name: "Save deployment record", exact: true })
        .click();
      await expect(
        page.getByRole("button", {
          name: "Save deployment record",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("list", { name: "Deployment history", exact: true }),
      ).toContainText(build);
    };
    await record(first!.id, "succeeded", "2026-01-02T12:00", "initial-build");
    await expect(production).toContainText("1.0.0");
    await expect(staging).toContainText("Not recorded");
    await record(second!.id, "failed", "2026-01-03T12:00", "failed-build");
    await expect(production).toContainText("1.0.0");
    await record(
      second!.id,
      "cancelled",
      "2026-01-04T12:00",
      "cancelled-build",
    );
    await expect(production).toContainText("1.0.0");
    await record(second!.id, "succeeded", "2026-01-05T12:00", "second-build");
    await expect(production).toContainText("2.0.0");
    await record(
      first!.id,
      "succeeded",
      "2026-01-01T12:00",
      "historical-build",
    );
    await expect(production).toContainText("2.0.0");
    await record(
      second!.id,
      "succeeded",
      "2026-01-05T12:00",
      "staging-build",
      "Staging",
    );
    await expect(staging).toContainText("2.0.0");
    await page
      .getByRole("button", { name: "Record deployment outcome", exact: true })
      .click();
    await page
      .getByLabel("Environment", { exact: true })
      .selectOption({ label: "Production" });
    await page
      .getByLabel("Release version (rollback source)", { exact: true })
      .selectOption(first!.id);
    await page
      .getByLabel("Deployment outcome", { exact: true })
      .selectOption("rollback");
    await page
      .getByLabel("Rollback target version", { exact: true })
      .selectOption(second!.id);
    await page
      .getByLabel("Rollback reason", { exact: true })
      .fill("Incorrect source");
    await page
      .getByLabel("Deployment started", { exact: true })
      .fill("2026-01-06T10:00");
    await page
      .getByLabel("Deployment completed", { exact: true })
      .fill("2026-01-06T12:00");
    await page
      .getByRole("button", { name: "Save deployment record", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Rollback source must match",
    );
    await expect(
      page.getByLabel("Rollback reason", { exact: true }),
    ).toHaveValue("Incorrect source");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await record(
      second!.id,
      "rollback",
      "2026-01-06T12:00",
      "rollback-build",
      "Production",
      first!.id,
    );
    await expect(production).toContainText("1.0.0");
    await expect(staging).toContainText("2.0.0");
    await expect(
      page
        .getByRole("list", { name: "Deployment history", exact: true })
        .getByRole("listitem")
        .filter({ hasText: "rollback-build" }),
    ).toContainText("2.0.0 → 1.0.0");
    await page.setViewportSize({ width: 390, height: 844 });
    await production.scrollIntoViewIfNeeded();
    await expect(production).toBeInViewport();
    await expect(
      page.getByRole("button", { name: "Close", exact: true }),
    ).toBeInViewport();
    await page.screenshot({
      path: test.info().outputPath("deployment-versions-mobile.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    await page
      .getByRole("button", { name: "Deployments", exact: true })
      .click();
    await expect(production).toContainText("1.0.0");
    await expect(staging).toContainText("2.0.0");
    const rows = await api<
      {
        id: string;
        outcome: string;
        rollback_target_id: string | null;
        recorded_by: string;
        readiness_warnings: string[];
      }[]
    >(owner, `shiplog_deployments?application_id=eq.${app!.id}`);
    expect(rows).toHaveLength(7);
    expect(rows!.every((row) => row.recorded_by === owner.user.id)).toBe(true);
    const rollback = rows!.find((row) => row.outcome === "rollback")!;
    expect(rollback.rollback_target_id).toBe(first!.id);
    expect(rollback.readiness_warnings).toEqual([
      "release_not_approved",
      "manual_qa_not_passed",
    ]);
    const audit = await api<{ details: { id: string } }[]>(
      owner,
      `shiplog_audit_events?release_id=eq.${second!.id}&event=eq.deployment.recorded`,
    );
    expect(audit!.some((row) => row.details.id === rollback.id)).toBe(true);
    const releases = await api<
      {
        status: string;
        published_at: string | null;
        first_deployed_at: string | null;
      }[]
    >(owner, `shiplog_releases?application_id=eq.${app!.id}`);
    expect(
      releases!.every(
        (row) =>
          row.status === "draft" &&
          row.published_at === null &&
          !!row.first_deployed_at,
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole("link", { name: "Releases", exact: true }).click();
    await page
      .getByRole("button", { name: /1\.0\.0\s*Initial launch/ })
      .click();
    await expect(
      page.getByRole("button", { name: "Edit draft", exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(/Release history is locked/)).toBeVisible();
    await page
      .getByRole("button", { name: "Deployments", exact: true })
      .click();
    await expect(production).toContainText("1.0.0");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await api(owner, "rpc/shiplog_set_application_public", {
      method: "POST",
      body: JSON.stringify({ application: app!.id, enabled: true }),
    });
    await api(owner, "rpc/shiplog_publish_release", {
      method: "POST",
      body: JSON.stringify({ release: first!.id, published: true }),
    });
    const token = await api<string>(owner, "rpc/shiplog_portal", {
      method: "POST",
      body: JSON.stringify({ workspace: workspace.id, enabled: true }),
    });
    const anonymous = await browser.newContext();
    contexts.push(anonymous);
    const publicPage = await anonymous.newPage();
    const loaded = publicPage.waitForResponse(
      (response) =>
        response.url().includes("/rpc/shiplog_public_catalog") &&
        response.request().method() === "POST",
    );
    await publicPage.goto(`http://127.0.0.1:5178/#/public/${token}/releases`);
    const payload = JSON.stringify(await (await loaded).json());
    for (const secret of [
      "SECRET",
      "pipeline_url",
      "first_deployed_at",
      "readiness_warnings",
      "deployment.recorded",
    ])
      expect(payload).not.toContain(secret);
    await expect(publicPage.getByRole("article")).toHaveCount(1);
  } finally {
    for (const context of contexts) await context.close();
    await removeWorkspace(owner, workspace.id);
  }
});
