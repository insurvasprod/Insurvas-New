// LA-4.1 (Notion sprint) · the storage adapter, the file registry and the three ingestion doors.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { parseDropPath, prefillFromFilename, safeFilename, syntheticStoragePath } from "./path.ts";
import { ingestCarrierFile } from "./pipeline.ts";
import { attributeAttachment, carrierForSender, readPostmarkInbound, sentOnFrom } from "./inboundEmail.ts";
import { storageProviderFrom } from "./storage.ts";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const TENANT = "d6f3950f-0d88-4e66-869f-0de2ea6b396b";
const USER = "1a01e923-c071-422d-96dd-08ff23e23075";
const AMERICO = { id: "aaaaaaaa-0000-4000-8000-000000000001", code: "americo", name: "Americo" };
const AETNA = { id: "aaaaaaaa-0000-4000-8000-000000000002", code: "aetna", name: "Aetna / CVS" };
const MOO = { id: "aaaaaaaa-0000-4000-8000-000000000003", code: "mutual_of_omaha", name: "Mutual of Omaha" };
const CARRIERS = [AMERICO, AETNA, MOO];
const CSV = new TextEncoder().encode("Policy,Status,Paid To\nA1,ACTIVE,2026-10-01\n");

/** An in-memory world: a storage adapter, a registry with the database's dedup and reissue rules. */
function world() {
  const objects = new Map();
  const rows = [];
  const skips = [];
  const storage = {
    async put(path, bytes) { objects.set(path, bytes); return path; },
    async get(path) { if (!objects.has(path)) throw new Error("missing"); return objects.get(path); },
    async list(prefix) { return [...objects.keys()].filter((key) => key.startsWith(prefix)); },
    async exists(path) { return objects.has(path); },
    async remove(path) { objects.delete(path); },
    async signedUrl(path) { return `signed:${path}`; },
  };
  let next = 0;
  const deps = {
    storage,
    sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
    findByHash: async (tenantId, hash) => {
      const row = rows.find((candidate) => candidate.tenantId === tenantId && candidate.contentHash === hash);
      return row ? { id: row.id, awaitingCarrier: row.carrierId === null && row.status === "failed" } : null;
    },
    carrierByCode: async (code) => CARRIERS.find((carrier) => carrier.code === code) ?? null,
    containerProblem: async (kind, bytes) => (kind === "xlsx" && bytes.length < 30 ? "The workbook could not be opened." : null),
    register: async (args) => {
      const held = rows.find((row) => row.tenantId === args.tenantId && row.contentHash === args.contentHash);
      // 20261009210000: a copy that names the carrier tells a file that failed only for want of one.
      if (held && held.carrierId === null && held.status === "failed" && args.carrierId && args.fileType && args.fileDate && args.status === "received") {
        Object.assign(held, { carrierId: args.carrierId, fileType: args.fileType, fileDate: args.fileDate, status: "received", errorDetail: null });
        return { outcome: "registered", fileId: held.id, supersededFileId: null, attributed: true, storagePath: held.storagePath };
      }
      if (held) { skips.push({ ...args, originalFileId: held.id }); return { outcome: "skipped", fileId: held.id }; }
      const id = `file-${++next}`;
      const current = args.carrierId && args.fileType && args.fileDate
        ? rows.find((row) => row.tenantId === args.tenantId && row.carrierId === args.carrierId && row.fileType === args.fileType && row.fileDate === args.fileDate && !row.supersededBy)
        : null;
      if (current) { current.supersededBy = id; current.status = "superseded"; }
      rows.push({ id, ...args, supersededBy: null });
      return { outcome: "registered", fileId: id, supersededFileId: current?.id ?? null };
    },
  };
  return { deps, objects, rows, skips };
}

const attributed = { fileDate: "2026-10-05", agency: "heritage", carrierCode: "americo", fileType: "commissions" };

test("the path attributes a file without opening it", () => {
  const parsed = parseDropPath(`${TENANT}/inbox/2026-10-05/heritage/Americo/Commissions/AMR 10-05.csv`);
  assert.deepEqual(parsed.problems, []);
  assert.equal(parsed.tenantId, TENANT);
  assert.deepEqual(parsed.attribution, { fileDate: "2026-10-05", agency: "heritage", carrierCode: "americo", fileType: "commissions" });
  assert.equal(parsed.filename, "AMR 10-05.csv");
  assert.equal(parseDropPath(`${TENANT}/inbox/2026-10-05/heritage/aetna/policies/x.xlsx`).attribution.fileType, "policies");

  const wrong = parseDropPath(`${TENANT}/inbox/2026-02-30/heritage/americo/Statements/x.csv`);
  assert.equal(wrong.attribution.fileDate, null, "30 February is not a date");
  assert.equal(wrong.attribution.carrierCode, "americo", "what can be read is kept");
  assert.equal(wrong.attribution.fileType, null);
  assert.equal(wrong.problems.length, 2);
  assert.match(parseDropPath(`${TENANT}/inbox/americo/x.csv`).problems[0], /expected folders/);
});

test("an upload or an email is kept at a synthetic path of the same shape", () => {
  const hash = "a".repeat(64);
  assert.equal(syntheticStoragePath(TENANT, "upload", attributed, hash, "Oct statement.csv"), `${TENANT}/upload/2026-10-05/heritage/americo/Commissions/aaaaaaaaaaaa__Oct statement.csv`);
  assert.equal(syntheticStoragePath(TENANT, "email", { ...attributed, agency: null, carrierCode: null }, hash, "x.pdf"), `${TENANT}/email/unattributed/aaaaaaaaaaaa__x.pdf`);
  assert.equal(safeFilename("../../etc/passwd"), "passwd");
  assert.equal(safeFilename("a\u0000b<>.csv"), "ab__.csv");
  assert.throws(() => syntheticStoragePath("not-a-tenant", "upload", attributed, hash, "x.csv"));
});

test("a recognisable file name fills the upload form in, and only when it is certain", () => {
  assert.deepEqual(prefillFromFilename("americo_commissions_2026-10-05.csv", CARRIERS), { fileDate: "2026-10-05", carrierId: AMERICO.id, fileType: "commissions" });
  assert.deepEqual(prefillFromFilename("Mutual of Omaha Policies 10-05-2026.xlsx", CARRIERS), { fileDate: "2026-10-05", carrierId: MOO.id, fileType: "policies" });
  assert.equal(prefillFromFilename("AETNA_comm_20261005.pdf", CARRIERS).fileType, "commissions");
  assert.equal(prefillFromFilename("AETNA_comm_20261005.pdf", CARRIERS).carrierId, AETNA.id);
  assert.equal(prefillFromFilename("americo vs aetna.csv", CARRIERS).carrierId, null, "two carriers named: no guess");
  assert.equal(prefillFromFilename("policies and commissions.csv", CARRIERS).fileType, null, "both types: no guess");
  assert.equal(prefillFromFilename("statement 2026-13-40.csv", CARRIERS).fileDate, null, "not a real date");
});

test("a file that failed only for want of its carrier is told it by the same bytes, not skipped forever", async () => {
  const { deps, rows, skips, objects } = world();
  const unknown = { fileDate: "2026-10-05", agency: null, carrierCode: null, fileType: "policies" };
  const first = await ingestCarrierFile(deps, { tenantId: TENANT, source: "email", uploadedBy: null, filename: "policies.csv", contentType: "text/csv", bytes: CSV, attribution: unknown, problems: ["We couldn't tell which carrier sent this."] });
  assert.equal(first.outcome, "registered");
  assert.equal(rows[0].status, "failed");
  const stored = objects.size;
  const again = await ingestCarrierFile(deps, { tenantId: TENANT, source: "upload", uploadedBy: USER, filename: "policies.csv", contentType: "text/csv", bytes: CSV, carrierId: AMERICO.id, attribution: { ...unknown, carrierCode: "americo" }, problems: [] });
  assert.equal(again.outcome, "registered", "read like a new arrival, so the door starts reading it");
  assert.equal(again.status, "received");
  assert.equal(again.fileId, first.fileId, "the same file, not a second one");
  assert.deepEqual([rows.length, rows[0].carrierId, rows[0].status, rows[0].errorDetail], [1, AMERICO.id, "received", null]);
  assert.equal(objects.size, stored, "its bytes are already stored: nothing stored twice");
  assert.equal(skips.length, 0);
  // Once told, it is an ordinary file: the same bytes again are a duplicate.
  assert.equal((await ingestCarrierFile(deps, { tenantId: TENANT, source: "upload", uploadedBy: USER, filename: "policies.csv", contentType: "text/csv", bytes: CSV, carrierId: AMERICO.id, attribution: { ...unknown, carrierCode: "americo" }, problems: [] })).outcome, "skipped");
  // A copy that still has no carrier is skipped as before.
  const { deps: d2, rows: r2 } = world();
  await ingestCarrierFile(d2, { tenantId: TENANT, source: "email", uploadedBy: null, filename: "p.csv", contentType: "text/csv", bytes: CSV, attribution: unknown, problems: ["no carrier"] });
  assert.equal((await ingestCarrierFile(d2, { tenantId: TENANT, source: "email", uploadedBy: null, filename: "p.csv", contentType: "text/csv", bytes: CSV, attribution: unknown, problems: ["no carrier"] })).outcome, "skipped");
  assert.equal(r2[0].carrierId, null);
});

test("each of the three doors produces the same registry row apart from source and uploaded_by", async () => {
  const shared = (row) => ({ carrierId: row.carrierId, fileType: row.fileType, fileDate: row.fileDate, pathAgency: row.pathAgency, contentHash: row.contentHash, fileBytes: row.fileBytes, fileKind: row.fileKind, status: row.status, errorDetail: row.errorDetail, originalFilename: row.originalFilename });
  const results = [];
  for (const [source, uploadedBy] of [["upload", USER], ["email", USER], ["bucket", null]]) {
    const { deps, rows } = world();
    const input = { tenantId: TENANT, source, uploadedBy, filename: "oct.csv", contentType: "text/csv", bytes: CSV, attribution: attributed, problems: [] };
    if (source === "bucket") input.storagePath = `${TENANT}/inbox/2026-10-05/heritage/americo/Commissions/oct.csv`;
    else input.carrierId = AMERICO.id;
    const outcome = await ingestCarrierFile(deps, input);
    assert.equal(outcome.outcome, "registered");
    results.push(rows[0]);
  }
  assert.deepEqual(shared(results[1]), shared(results[0]));
  assert.deepEqual(shared(results[2]), shared(results[0]));
  assert.deepEqual(results.map((row) => [row.source, row.uploadedBy]), [["upload", USER], ["email", USER], ["bucket", null]]);
  assert.equal(results[0].carrierId, AMERICO.id);
});

test("a deliberately corrupt file is still attributed correctly from its path, and fails visibly", async () => {
  const { deps, rows } = world();
  const path = `${TENANT}/inbox/2026-10-05/heritage/aetna/Policies/broken.xlsx`;
  const parsed = parseDropPath(path);
  const outcome = await ingestCarrierFile(deps, {
    tenantId: TENANT, source: "bucket", uploadedBy: null, filename: parsed.filename, contentType: null,
    bytes: new TextEncoder().encode("this is not a workbook"), attribution: parsed.attribution, problems: parsed.problems, storagePath: path,
  });
  assert.equal(outcome.outcome, "registered");
  assert.equal(outcome.status, "failed");
  assert.match(outcome.errorDetail, /not the Excel workbook/);
  assert.deepEqual({ carrierId: rows[0].carrierId, fileType: rows[0].fileType, fileDate: rows[0].fileDate, pathAgency: rows[0].pathAgency }, { carrierId: AETNA.id, fileType: "policies", fileDate: "2026-10-05", pathAgency: "heritage" });
  assert.equal(rows[0].storagePath, path);
});

test("a workbook that will not open, an unknown carrier code and an empty file all fail with the reason", async () => {
  const { deps } = world();
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
  const base = { tenantId: TENANT, source: "upload", uploadedBy: USER, contentType: null, problems: [] };
  assert.match((await ingestCarrierFile(deps, { ...base, filename: "a.xlsx", bytes: zip, carrierId: AMERICO.id, attribution: attributed })).errorDetail, /could not be opened/);
  assert.match((await ingestCarrierFile(deps, { ...base, source: "bucket", uploadedBy: null, storagePath: `${TENANT}/inbox/x`, filename: "b.csv", bytes: new TextEncoder().encode("b"), attribution: { ...attributed, carrierCode: "nobody" } })).errorDetail, /No carrier in the library has the code "nobody"/);
  assert.match((await ingestCarrierFile(deps, { ...base, filename: "c.csv", bytes: new Uint8Array(), carrierId: AMERICO.id, attribution: attributed })).errorDetail, /empty/);
});

test("the same bytes again are skipped and the skip recorded; nothing is stored twice", async () => {
  const { deps, objects, rows, skips } = world();
  const input = { tenantId: TENANT, source: "upload", uploadedBy: USER, filename: "oct.csv", contentType: "text/csv", bytes: CSV, carrierId: AMERICO.id, attribution: attributed, problems: [] };
  const first = await ingestCarrierFile(deps, input);
  const again = await ingestCarrierFile(deps, { ...input, filename: "oct (1).csv", source: "email" });
  assert.equal(again.outcome, "skipped");
  assert.equal(again.fileId, first.fileId, "the skip points at the file already held");
  assert.equal(rows.length, 1);
  assert.equal(skips.length, 1);
  assert.equal(skips[0].source, "email");
  assert.equal(objects.size, 1);
});

test("a changed file for the same carrier, type and day supersedes the old one, which stays readable", async () => {
  const { deps, objects, rows } = world();
  const input = { tenantId: TENANT, source: "upload", uploadedBy: USER, filename: "oct.csv", contentType: "text/csv", carrierId: AMERICO.id, attribution: attributed, problems: [] };
  const first = await ingestCarrierFile(deps, { ...input, bytes: CSV });
  const corrected = await ingestCarrierFile(deps, { ...input, bytes: new TextEncoder().encode("Policy,Status\nA1,LAPSED\n") });
  assert.equal(corrected.supersededFileId, first.fileId);
  assert.equal(rows[0].status, "superseded");
  assert.equal(rows[0].supersededBy, corrected.fileId);
  assert.ok(await deps.storage.get(rows[0].storagePath), "the old original is still there");
  assert.equal(objects.size, 2);
});

test("a registration that fails or loses the race takes back the object it stored", async () => {
  const { deps, objects } = world();
  const input = { tenantId: TENANT, source: "upload", uploadedBy: USER, filename: "oct.csv", contentType: "text/csv", bytes: CSV, carrierId: AMERICO.id, attribution: attributed, problems: [] };
  await assert.rejects(ingestCarrierFile({ ...deps, register: async () => { throw new Error("db down"); } }, input), /db down/);
  assert.equal(objects.size, 0);
  const raced = await ingestCarrierFile({ ...deps, register: async () => ({ outcome: "skipped", fileId: "other" }) }, input);
  assert.equal(raced.outcome, "skipped");
  assert.equal(objects.size, 0);
});

test("the storage adapter names no provider: only the Supabase implementation touches Supabase Storage", () => {
  const files = [];
  const walk = (dir) => { for (const name of readdirSync(dir)) { const full = join(dir, name); if (statSync(full).isDirectory()) { if (name !== "node_modules" && !name.startsWith(".")) walk(full); } else if (/\.(ts|tsx)$/.test(name)) files.push(full); } };
  const root = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
  for (const dir of ["lib/ingestion", "app/api/app/carrier-files", "app/api/webhooks/postmark-inbound", "app/api/internal/carrier-files"]) walk(join(root, dir));
  const touching = files.filter((file) => /\.storage\s*\.from\(|@supabase\//.test(readFileSync(file, "utf8"))).map((file) => file.replace(/\\/g, "/").split("/").slice(-2).join("/"));
  assert.deepEqual(touching, ["ingestion/supabaseStorage.ts"]);
  const adapter = read("lib/ingestion/storage.ts");
  assert.doesNotMatch(adapter, /^import /m, "the interface imports nothing");
  assert.equal(storageProviderFrom(undefined), "supabase");
  assert.throws(() => storageProviderFrom("dropbox"), /not a storage provider/);
});

test("the registry: agency_id is there and nullable, files are never deleted, and identity cannot change", () => {
  const sql = read("supabase/migrations/20261008100000_la_4_1_file_registry.sql");
  assert.match(sql, /\n  agency_id uuid,\n/, "nullable: no not null");
  assert.match(sql, /revoke delete, truncate on public\.file_registry from service_role, tenant_app/);
  assert.match(sql, /unique \(tenant_id, content_hash\)/);
  assert.match(sql, /file_registry_current_key[\s\S]*?where superseded_by_file_id is null/);
  assert.match(sql, /A registered file''s identity cannot change/);
  assert.match(sql, /status = 'failed' or \(carrier_id is not null and file_type is not null and file_date is not null\)/);
  assert.match(sql, /constraint file_registry_failed_says_why check \(status <> 'failed' or error_detail is not null\)/);
  assert.match(sql, /update public\.file_registry\s+set superseded_by_file_id = v_new/, "the old file is superseded, not removed");
});

test("the email door: the agency's token from the address, exact sender match, attachments only of a file kind", () => {
  const token = "k3j4h5g6f7d8s9a0q1w2";
  const message = readPostmarkInbound({
    FromFull: { Email: "Commissions@Americo.com" },
    ToFull: [{ Email: `${token}@in.insurvas.com`, MailboxHash: "" }],
    Subject: "Your commission statement",
    MessageID: "m-1",
    Date: "Mon, 5 Oct 2026 09:14:00 -0500",
    Attachments: [
      { Name: "AMR_2026-10-04.csv", Content: btoa("Policy,Amount\nA1,1.00\n"), ContentType: "text/csv" },
      { Name: "logo.png", Content: btoa("png"), ContentType: "image/png" },
    ],
  });
  assert.deepEqual(message.tokens, [token]);
  assert.equal(message.from, "commissions@americo.com");
  assert.equal(message.attachments.length, 1, "the signature image is not a statement");
  assert.equal(new TextDecoder().decode(message.attachments[0].bytes), "Policy,Amount\nA1,1.00\n");
  assert.equal(message.sentOn, "2026-10-05");
  assert.deepEqual(readPostmarkInbound({ MailboxHash: token.toUpperCase(), ToFull: [{ Email: `abc+${token}@inbound.postmarkapp.com` }] }).tokens, [token]);

  const senders = [{ carrierId: AETNA.id, sender: "@americo.com", tenantId: null }, { carrierId: AMERICO.id, sender: "commissions@americo.com", tenantId: TENANT }];
  assert.equal(carrierForSender("commissions@americo.com", senders), AMERICO.id, "the agency's exact address first");
  assert.equal(carrierForSender("other@americo.com", senders), AETNA.id, "then the platform's domain");
  assert.equal(carrierForSender("commissions@americo.com ", senders), null, "exact: a trailing space is a different sender");
  assert.equal(carrierForSender("x@americo.co", senders), null);

  const sorted = attributeAttachment(message, "AMR_2026-10-04.csv", senders, CARRIERS);
  assert.deepEqual(sorted.problems, []);
  assert.deepEqual(sorted.attribution, { fileDate: "2026-10-04", agency: null, carrierCode: "americo", fileType: "commissions" });
  const unknown = attributeAttachment({ from: "agent@gmail.com", subject: "fwd", sentOn: "2026-10-05" }, "scan.pdf", [], CARRIERS);
  assert.equal(unknown.carrierId, null);
  assert.equal(unknown.attribution.fileDate, "2026-10-05", "the day it was sent, never the contents");
  assert.equal(unknown.problems.length, 2);
  assert.equal(sentOnFrom("not a date"), null);
});
