import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";
import { removeLocalAccount } from "./local-helpers";

async function token(
  request: APIRequestContext,
  claims: Record<string, unknown>,
) {
  const response = await request.post("http://127.0.0.1:5301/test-token", {
    data: claims,
  });
  expect(response.ok()).toBe(true);
  return (await response.json()).token as string;
}

test("missing or malformed Access tokens cannot read platform data", async ({
  request,
}) => {
  for (const headers of [{}, { "Cf-Access-Jwt-Assertion": "malformed" }]) {
    const response = await request.get("/api/me", { headers });
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toBe("no-store");
  }
});

test("verified new users have no permissions and keep their subject identity", async ({
  request,
}) => {
  let accountId: string | undefined;
  try {
    const sub = `local-e2e-${randomUUID()}`;
    const jwt = await token(request, { sub, email: "employee@example.com" });
    const response = await request.get("/api/me", {
      headers: { "Cf-Access-Jwt-Assertion": jwt },
    });
    expect(response.status()).toBe(200);
    const account = await response.json();
    accountId = account.id;
    expect(account.grants).toEqual([]);
    const changed = await token(request, { sub, email: "renamed@example.com" });
    const next = await request.get("/api/me", {
      headers: { "Cf-Access-Jwt-Assertion": changed },
    });
    expect((await next.json()).id).toBe(account.id);
  } finally {
    if (accountId) removeLocalAccount(accountId);
  }
});

test("the same email does not inherit another subject's account", async ({
  request,
}) => {
  const ids: string[] = [];
  try {
    for (let i = 0; i < 2; i++) {
      const jwt = await token(request, {
        sub: `local-e2e-${randomUUID()}`,
        email: "same@example.com",
      });
      const response = await request.get("/api/me", {
        headers: { "Cf-Access-Jwt-Assertion": jwt },
      });
      expect(response.status()).toBe(200);
      const account = await response.json();
      expect(account.grants).toEqual([]);
      ids.push(account.id);
    }
    expect(ids[0]).not.toBe(ids[1]);
  } finally {
    for (const id of ids) removeLocalAccount(id);
  }
});

test("wrong audience, issuer, expiry and absent user claims are rejected", async ({
  request,
}) => {
  for (const override of [
    { aud: "other-app" },
    { iss: "https://other.example" },
    { exp: 1 },
    { email: null },
    { sub: null },
  ]) {
    const jwt = await token(request, {
      sub: `local-e2e-${randomUUID()}`,
      email: "employee@example.com",
      ...override,
    });
    const response = await request.get("/api/me", {
      headers: { "Cf-Access-Jwt-Assertion": jwt },
    });
    expect(response.status()).toBe(401);
  }
});
