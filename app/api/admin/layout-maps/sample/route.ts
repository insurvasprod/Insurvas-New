import { NextResponse, type NextRequest } from "next/server";

import { resolveAdminContext } from "@/lib/adminAuth/requireAdminRole";
import { FILE_TYPES, MAX_UPLOAD_BYTES, type CarrierFileType } from "@/lib/ingestion/constants";
import { layoutAdmin, layoutFailure } from "@/lib/ingestion/layoutAdminHttp";
import { readSampleFile } from "@/lib/ingestion/layoutSample";

/**
 * A layout drafted from a sample file (owner request 2026-10-14): multipart `file`, `file_type`, and
 * optionally `sheet` (a workbook's sheet to read). Returns every column with what it would become,
 * and a few rows for the preview. Reads only: the file is not stored, and nothing is written until
 * staff create the layout from the draft.
 */
export async function POST(request: NextRequest) {
  const scope = layoutAdmin(await resolveAdminContext());
  if (scope instanceof NextResponse) return scope;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const fileType = form?.get("file_type");
  const sheet = form?.get("sheet");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a sample file." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: `The file is over ${Math.round(MAX_UPLOAD_BYTES / 1_000_000)} MB.` }, { status: 413 });
  if (typeof fileType !== "string" || !(FILE_TYPES as readonly string[]).includes(fileType)) return NextResponse.json({ error: "Say which file type." }, { status: 400 });
  try {
    const read = await readSampleFile(new Uint8Array(await file.arrayBuffer()), file.name, fileType as CarrierFileType, typeof sheet === "string" && sheet.trim() ? sheet : null);
    return NextResponse.json(read, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return layoutFailure(error);
  }
}
