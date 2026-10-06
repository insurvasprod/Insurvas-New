/**
 * LA-4.1 (Notion sprint) · a carrier file is attributed by its path, never by opening it.
 *
 * The convention (Module 4 doc §3.4, the BRD's Drive layout):
 *
 *     <date>/<agency>/<carrier>/<Policies|Commissions>/<filename>
 *
 * In the bucket each agency's scripts write under its own workspace and an inbox:
 *
 *     <tenant id>/inbox/2026-10-05/heritage/americo/Commissions/statement.pdf
 *
 * Because the four facts come from the path, a file that turns out to be unreadable still lands in
 * the registry correctly attributed — it fails visibly instead of vanishing. An upload or an email
 * has no path, so its door collects the same facts and writes a synthetic one.
 *
 * Pure; relative imports only.
 */
import { FILE_TYPE_PATH_SEGMENT, type CarrierFileSource, type CarrierFileType } from "./constants.ts";

export type Attribution = {
  fileDate: string | null;
  agency: string | null;
  carrierCode: string | null;
  fileType: CarrierFileType | null;
};

export type ParsedDropPath = {
  tenantId: string | null;
  filename: string;
  attribution: Attribution;
  /** What the path could not tell, in sentences a person can act on. Empty when fully attributed. */
  problems: string[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CARRIER_CODE = /^[a-z][a-z0-9_]*$/;

/** A record id (a lowercase UUID). */
export function isRecordUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** A real calendar date in YYYY-MM-DD, or null. */
export function isoDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (year < 2000 || year > 2100) return null;
  return value;
}

export function fileTypeFromSegment(segment: string): CarrierFileType | null {
  const word = segment.trim().toLowerCase();
  if (word === "policies") return "policies";
  if (word === "commissions") return "commissions";
  return null;
}

/**
 * Reads a bucket object's name: <tenant>/inbox/<date>/<agency>/<carrier>/<Policies|Commissions>/<file>.
 * Whatever can be read is kept even when another part is wrong, so the failure says exactly why.
 */
export function parseDropPath(objectName: string): ParsedDropPath {
  const parts = objectName.split("/");
  const filename = parts[parts.length - 1] ?? "";
  const problems: string[] = [];
  const tenantId = UUID.test(parts[0] ?? "") ? parts[0] : null;
  const attribution: Attribution = { fileDate: null, agency: null, carrierCode: null, fileType: null };

  if (parts.length !== 7 || parts[1] !== "inbox") {
    problems.push("The file is not in the expected folders: <date>/<agency>/<carrier>/<Policies or Commissions>/<file>.");
    return { tenantId, filename, attribution, problems };
  }
  const [, , date, agency, carrier, type] = parts;

  attribution.fileDate = isoDate(date);
  if (!attribution.fileDate) problems.push(`"${date}" is not a date in the form YYYY-MM-DD.`);

  attribution.agency = agency.trim() ? agency.trim().slice(0, 120) : null;
  if (!attribution.agency) problems.push("The agency folder is empty.");

  const code = carrier.trim().toLowerCase();
  attribution.carrierCode = CARRIER_CODE.test(code) ? code : null;
  if (!attribution.carrierCode) problems.push(`"${carrier}" is not a carrier code.`);

  attribution.fileType = fileTypeFromSegment(type);
  if (!attribution.fileType) problems.push(`"${type}" must be Policies or Commissions.`);

  if (!filename.trim()) problems.push("The file has no name.");
  return { tenantId, filename, attribution, problems };
}

/** A file name safe to keep in a storage path: no folders, no control characters, at most 120 characters. */
export function safeFilename(name: string): string {
  const base = (name.split(/[\\/]/).pop() ?? "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  const cleaned = base.replace(/[^A-Za-z0-9 ._()+-]/g, "_");
  if (!cleaned) return "file";
  if (cleaned.length <= 120) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const ext = dot > 0 && cleaned.length - dot <= 8 ? cleaned.slice(dot) : "";
  return cleaned.slice(0, 120 - ext.length) + ext;
}

/**
 * Where an upload or an email is kept — the synthetic path the doc asks for, in the same shape as a
 * drop, under the door it came through. The content hash keeps two different files of one name apart.
 */
export function syntheticStoragePath(
  tenantId: string,
  source: Exclude<CarrierFileSource, "bucket">,
  attribution: Attribution,
  sha256: string,
  filename: string,
): string {
  if (!UUID.test(tenantId)) throw new Error("A carrier file is stored under its workspace.");
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("A carrier file is stored with its SHA-256.");
  const name = `${sha256.slice(0, 12)}__${safeFilename(filename)}`;
  const { fileDate, carrierCode, fileType } = attribution;
  if (!fileDate || !carrierCode || !fileType) return `${tenantId}/${source}/unattributed/${name}`;
  const agency = attribution.agency ? safeFilename(attribution.agency).replace(/\s/g, "_") : "-";
  return `${tenantId}/${source}/${fileDate}/${agency}/${carrierCode}/${FILE_TYPE_PATH_SEGMENT[fileType]}/${name}`;
}

export type CarrierChoice = { id: string; code: string; name: string };

export type Prefill = { fileDate: string | null; carrierId: string | null; fileType: CarrierFileType | null };

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function dateInName(name: string): string | null {
  const iso = /(20\d{2})[-_.]?(0[1-9]|1[0-2])[-_.]?(0[1-9]|[12]\d|3[01])(?!\d)/.exec(name);
  if (iso) {
    const value = isoDate(`${iso[1]}-${iso[2]}-${iso[3]}`);
    if (value) return value;
  }
  const us = /(?<!\d)(0[1-9]|1[0-2])[-_.](0[1-9]|[12]\d|3[01])[-_.](20\d{2})(?!\d)/.exec(name);
  if (us) return isoDate(`${us[3]}-${us[1]}-${us[2]}`);
  return null;
}

/**
 * What a recognisable file name already says, to fill the upload form in. Only a certain reading is
 * offered: two carriers named in one file name, or both types, fill in nothing for that field.
 */
export function prefillFromFilename(filename: string, carriers: CarrierChoice[]): Prefill {
  const base = filename.replace(/\.[a-z0-9]{1,5}$/i, "");
  const flat = compact(base);
  const matches = carriers.filter((carrier) => {
    const code = compact(carrier.code);
    const name = compact(carrier.name);
    const first = compact(carrier.name.split(/[\s/&,-]+/)[0] ?? "");
    return (code.length >= 3 && flat.includes(code)) || (name.length >= 4 && flat.includes(name)) || (first.length >= 5 && flat.includes(first));
  });
  const lower = base.toLowerCase();
  // Underscores and digits separate words in file names, so no \b here.
  const policies = /polic/.test(lower);
  const commissions = /commission|statement|(^|[^a-z])(comm|comp)([^a-z]|$)/.test(lower);
  return {
    fileDate: dateInName(base),
    carrierId: matches.length === 1 ? matches[0].id : null,
    fileType: policies === commissions ? null : policies ? "policies" : "commissions",
  };
}
