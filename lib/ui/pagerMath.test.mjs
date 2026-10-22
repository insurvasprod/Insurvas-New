// The one pager's arithmetic: which page numbers it draws, and the address of a server page.
import test from "node:test";
import assert from "node:assert/strict";

const { pageItems, withPage } = await import("./pagerMath.ts");

test("seven pages or fewer: every page number", () => {
  assert.deepEqual(pageItems(1, 1), [1]);
  assert.deepEqual(pageItems(4, 7), [1, 2, 3, 4, 5, 6, 7]);
});

test("more pages: first, last, the current page and its neighbours, with gaps", () => {
  assert.deepEqual(pageItems(1, 20), [1, 2, 3, 4, "gap", 20]);
  assert.deepEqual(pageItems(10, 20), [1, "gap", 9, 10, 11, "gap", 20]);
  assert.deepEqual(pageItems(20, 20), [1, "gap", 17, 18, 19, 20]);
  // A gap of one page shows that page instead of an ellipsis.
  assert.deepEqual(pageItems(4, 20), [1, 2, 3, 4, 5, "gap", 20]);
  for (let current = 1; current <= 40; current++) {
    const items = pageItems(current, 40);
    assert.ok(items.includes(current) && items.includes(1) && items.includes(40), `page ${current}`);
    assert.ok(items.length <= 9, `page ${current} draws ${items.length} items`);
  }
});

test("a server page's address keeps its other parameters", () => {
  assert.equal(withPage("/admin/tenants/t1?tab=activity", 3), "/admin/tenants/t1?tab=activity&page=3");
  assert.equal(withPage("/admin/tenants/t1?tab=activity&page=3", 1), "/admin/tenants/t1?tab=activity");
  assert.equal(withPage("?", 2), "?page=2");
  assert.equal(withPage("?page=4", 1), "?");
});
