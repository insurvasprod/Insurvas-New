import assert from "node:assert/strict";
import test from "node:test";

import { scopeWithSelf, waitingTransferOr } from "./scope.ts";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

test("AG-0.5: no scope stays no scope; a scope always includes the reader, once", () => {
  assert.equal(scopeWithSelf(null, A), null);
  assert.deepEqual(scopeWithSelf([], A), [A]);
  assert.deepEqual(scopeWithSelf([A, B], A), [A, B]);
});

test("AG-0.5: transfers a scoped session counts are the waiting ones and its own holders' only", () => {
  assert.equal(waitingTransferOr([A, B]), `owner_user_id.is.null,owner_user_id.in.(${A},${B})`);
  // Anything that is not a uuid never reaches the filter.
  assert.equal(waitingTransferOr(["x),status.eq.claimed"]), "owner_user_id.is.null");
});
