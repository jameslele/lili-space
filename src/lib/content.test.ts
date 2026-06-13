import { describe, expect, it } from "vitest";

import type { CurrentUser } from "./auth";
import { canViewAllPosts, canViewPost, isHiddenFromHome, isPublicPublishedPost } from "./content";

const admin: CurrentUser = { id: "admin-id", username: "root", display_name: "理哩", role: "admin" };
const reader: CurrentUser = { id: "reader-id", username: "reader", display_name: "Reader", role: "reader" };

describe("content visibility helpers", () => {
  it("allows only admins to view all posts", () => {
    expect(canViewAllPosts(admin)).toBe(true);
    expect(canViewAllPosts(reader)).toBe(false);
    expect(canViewAllPosts(null)).toBe(false);
  });

  it("treats only public published posts as generally visible", () => {
    expect(isPublicPublishedPost({ status: "published", visibility: "public" })).toBe(true);
    expect(isPublicPublishedPost({ status: "published", visibility: "private" })).toBe(false);
    expect(isPublicPublishedPost({ status: "draft", visibility: "public" })).toBe(false);
    expect(isPublicPublishedPost({ status: "archived", visibility: "public" })).toBe(false);
  });

  it("blocks non-admins from private, draft, and archived posts", () => {
    const restricted = [
      { status: "published" as const, visibility: "private" as const },
      { status: "draft" as const, visibility: "public" as const },
      { status: "archived" as const, visibility: "public" as const },
    ];

    for (const post of restricted) {
      expect(canViewPost(post, null)).toBe(false);
      expect(canViewPost(post, reader)).toBe(false);
      expect(canViewPost(post, admin)).toBe(true);
    }
  });

  it("hides noindex posts from the public home feed only", () => {
    expect(isHiddenFromHome({ noindex: true }, null)).toBe(true);
    expect(isHiddenFromHome({ noindex: true }, reader)).toBe(true);
    expect(isHiddenFromHome({ noindex: true }, admin)).toBe(false);
    expect(isHiddenFromHome({ noindex: false }, null)).toBe(false);
  });
});
