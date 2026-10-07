import { NextResponse, type NextRequest } from "next/server";

import { resolveAdminContext } from "@/lib/adminAuth/requireAdminRole";
import { listFilesWaitingForLayout, waitingFileHeaders } from "@/lib/ingestion/layoutAdmin";
import { isId, layoutAdmin, layoutFailure } from "@/lib/ingestion/layoutAdminHttp";

/**
 * LA-4.3 · write a layout from a real file: `?file_type=` lists the files waiting for a layout of
 * that type; `?file_id=` returns one of them's column headers. Reads only; the rows never leave.
 */
export async function GET(request: NextRequest) {
  const scope = layoutAdmin(await resolveAdminContext());
  if (scope instanceof NextResponse) return scope;
  const params = request.nextUrl.searchParams;
  const fileId = params.get("file_id");
  const fileType = params.get("file_type");
  try {
    if (fileId) {
      if (!isId(fileId)) return NextResponse.json({ error: "Choose a file from the list." }, { status: 400 });
      return NextResponse.json({ headers: await waitingFileHeaders(fileId) }, { headers: { "Cache-Control": "no-store" } });
    }
    if (fileType !== "policies" && fileType !== "commissions") return NextResponse.json({ error: "Say which file type." }, { status: 400 });
    return NextResponse.json({ files: await listFilesWaitingForLayout(fileType) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return layoutFailure(error);
  }
}
