"use client";

/** Browser-side calls go to /api/*, which Next proxies to the API on the same origin. */
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      /* ignore */
    }
    throw Object.assign(new Error(message), { status: res.status });
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** SHA-256 of a File via Web Crypto, for the pre-upload duplicate check (spec §2 stage 0). */
export async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Multipart upload with progress; XHR because fetch has no upload progress events. */
export function uploadFile<T>(file: File, onProgress: (fraction: number) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/documents");
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(JSON.parse(xhr.responseText) as T);
      else {
        let message = `Upload failed (${xhr.status})`;
        try {
          message = (JSON.parse(xhr.responseText) as { message?: string }).message ?? message;
        } catch {
          /* ignore */
        }
        reject(new Error(message));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    const form = new FormData();
    form.append("file", file, file.name);
    xhr.send(form);
  });
}
