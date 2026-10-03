import { describe, expect, it } from "vitest";
import { safeNextPath, signSession, verifySession } from "@/server/auth/session";

describe("safeNextPath", () => {
  it("keeps same-origin paths with query and hash", () => {
    expect(safeNextPath("/approvals")).toBe("/approvals");
    expect(safeNextPath("/analytics?client=a&days=30#goal")).toBe("/analytics?client=a&days=30#goal");
  });

  it("rejects anything that could leave the site", () => {
    for (const bad of ["//evil.com", "/\\evil.com", "/\\/evil.com", "https://evil.com", "evil.com", "/%0d%0aSet-Cookie:x", "\t/evil", "", null, undefined]) {
      const out = safeNextPath(bad as string | null | undefined);
      expect(out.startsWith("/")).toBe(true);
      expect(out.startsWith("//")).toBe(false);
      expect(out).not.toContain("evil.com");
    }
    expect(safeNextPath("/\\evil.com")).toBe("/");
  });
});

describe("session tokens", () => {
  it("round-trips and rejects a token signed with another secret", async () => {
    const secret = "a-secret-that-is-long-enough-for-hs256-signing";
    const token = await signSession("owner@example.com", secret);
    expect((await verifySession(token, secret))?.email).toBe("owner@example.com");
    expect(await verifySession(token, `${secret}-other`)).toBeNull();
    expect(await verifySession("not-a-token", secret)).toBeNull();
    expect(await verifySession(undefined, secret)).toBeNull();
  });
});
