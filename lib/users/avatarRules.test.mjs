// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";

import { AVATAR_MAX_BYTES, avatarFileProblem, avatarMagicMatches, avatarObjectPath } from "./avatarRules.ts";

test("the bytes must be the image type the file claims", () => {
  const bytes = (...values) => new Uint8Array(values);
  assert.equal(avatarMagicMatches("image/jpeg", bytes(0xff, 0xd8, 0xff, 0xe0)), true);
  assert.equal(avatarMagicMatches("image/png", bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a)), true);
  assert.equal(avatarMagicMatches("image/webp", bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)), true);
  assert.equal(avatarMagicMatches("image/png", bytes(0x25, 0x50, 0x44, 0x46)), false, "a PDF renamed .png");
  assert.equal(avatarMagicMatches("image/jpeg", bytes(0x89, 0x50, 0x4e, 0x47)), false, "a PNG sent as JPEG");
  assert.equal(avatarMagicMatches("image/webp", bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45)), false, "a WAV is RIFF too");
});

test("a profile picture is a JPG, PNG or WebP under 2 MB", () => {
  assert.equal(avatarFileProblem({ type: "image/png", size: 120_000 }), null);
  assert.equal(avatarFileProblem({ type: "image/jpeg", size: AVATAR_MAX_BYTES }), null);
  assert.equal(avatarFileProblem({ type: "image/webp", size: 1 }), null);
  assert.match(avatarFileProblem({ type: "image/gif", size: 10 }) ?? "", /JPG, PNG or WebP/);
  assert.match(avatarFileProblem({ type: "image/svg+xml", size: 10 }) ?? "", /JPG, PNG or WebP/, "an SVG can carry script");
  assert.match(avatarFileProblem({ type: "image/png", size: AVATAR_MAX_BYTES + 1 }) ?? "", /under 2 MB/);
  assert.match(avatarFileProblem({ type: "image/png", size: 0 }) ?? "", /empty/);
});

test("each upload gets its own object under the person's folder", () => {
  assert.equal(avatarObjectPath("u1", "image/png", "1700000000000"), "u1/1700000000000.png");
  assert.equal(avatarObjectPath("u1", "image/jpeg", "a"), "u1/a.jpg");
  assert.equal(avatarObjectPath("u1", "image/webp", "a"), "u1/a.webp");
});
