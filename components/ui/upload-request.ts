/**
 * An upload that reports how far it has gone (Tier 2 motion, Wave B 2026-11-18), for UploadProgress. It is `fetch`
 * for a file: the same request, answered by the same kind of object (`ok`, `status`, `json()`), so an upload door
 * swaps `fetch(url, { method: "POST", body: form })` for `sendWithProgress(url, form, setProgress)` and keeps the rest
 * of its handling as it was. A network failure rejects with the TypeError fetch gives.
 *
 * `onProgress` gets 0–0.95 while the bytes go up: the last stretch is the server reading the file, so the bar only
 * reaches 1 when the caller says the upload is done (and UploadProgress draws its check).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- typed as fetch's Response.json(), so a door swaps one for the other
export type UploadAnswer = { ok: boolean; status: number; json: () => Promise<any> };

export const UPLOAD_SENT = 0.95;

export function sendWithProgress(url: string, body: FormData, onProgress: (fraction: number) => void, method: "POST" | "PUT" | "PATCH" = "POST"): Promise<UploadAnswer> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(method, url);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress(Math.min(UPLOAD_SENT, (event.loaded / event.total) * UPLOAD_SENT));
    };
    request.upload.onload = () => onProgress(UPLOAD_SENT);
    request.onload = () => {
      const text = request.responseText;
      resolve({
        ok: request.status >= 200 && request.status < 300,
        status: request.status,
        json: async () => JSON.parse(text),
      });
    };
    request.onerror = () => reject(new TypeError("Failed to fetch"));
    request.onabort = () => reject(new TypeError("Failed to fetch"));
    onProgress(0);
    request.send(body);
  });
}
