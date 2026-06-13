import { describe, expect, it } from "vitest";

import { hashPassword, hashSessionToken, verifyPassword } from "./auth";

describe("auth crypto helpers", () => {
  it("hashes and verifies passwords without keeping plaintext", async () => {
    const password = "sample-password";
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    expect(hash.startsWith("$2")).toBe(true);
    await expect(verifyPassword(password, hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("hashes session tokens deterministically without storing the raw token", () => {
    const token = "session-token-value";

    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
    expect(hashSessionToken(token)).not.toBe(token);
    expect(hashSessionToken(token)).toHaveLength(64);
  });
});
