import assert from "node:assert/strict";
import test from "node:test";
import { isAllowed } from "../src/security/access.js";

test("empty allowlists permit installed workspace users", () => {
  assert.equal(
    isAllowed({
      userId: "U1",
      channelId: "C1",
      allowedUserIds: new Set(),
      allowedChannelIds: new Set()
    }),
    true
  );
});

test("both configured allowlists must match", () => {
  assert.equal(
    isAllowed({
      userId: "U1",
      channelId: "C2",
      allowedUserIds: new Set(["U1"]),
      allowedChannelIds: new Set(["C1"])
    }),
    false
  );
});
