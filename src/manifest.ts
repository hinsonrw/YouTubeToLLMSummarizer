import { readFile, writeFile, mkdir } from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

export type ManifestEntry = {
  videoId: string;
  sourceUrl: string;
  transcript_sha256: string;
  config_sha256: string;
  processed_at: string;
  outputs: { json: string; md: string; log: string };
};

export type Manifest = {
  version: number;
  entries: Record<string, ManifestEntry>;
};

const MANIFEST_PATH = path.join("out", "manifest.json");

export async function ensureOutDir() {
  await mkdir("out", { recursive: true });
}

export function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf-8").digest("hex");
}

export async function loadManifest(): Promise<Manifest> {
  try {
    const raw = await readFile(MANIFEST_PATH, "utf-8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return { version: 1, entries: {} };
  }
}

export async function saveManifest(m: Manifest): Promise<void> {
  await ensureOutDir();
  await writeFile(MANIFEST_PATH, JSON.stringify(m, null, 2), "utf-8");
}

export function shouldSkip(
  manifest: Manifest,
  videoId: string,
  transcriptSha: string,
  configSha: string
): boolean {
  const e = manifest.entries[videoId];
  if (!e) return false;
  return e.transcript_sha256 === transcriptSha && e.config_sha256 === configSha;
}

export function upsertEntry(
  manifest: Manifest,
  entry: ManifestEntry
) {
  manifest.entries[entry.videoId] = entry;
}
