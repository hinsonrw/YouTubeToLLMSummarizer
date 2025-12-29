import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type LlmCallLog = {
  stage: "chunk_summary" | "final_synthesis";
  chunkIndex?: number;
  model: string;
  prompt: string;
  response: string;
  timestamp: string;
};

export type VideoLog = {
  videoId: string;
  sourceUrl: string;
  runId: string;
  timestamps: { startedAt: string; finishedAt?: string };
  transcript?: { charCount: number; text: string };
  chunk_summaries?: { count: number; items: string[] };
  llm_calls: LlmCallLog[];
  final_outputs?: { summary_json: unknown; summary_markdown: string };
};

export async function initRunLog(runId: string) {
  const dir = path.join("logs", runId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export function createVideoLog(videoId: string, sourceUrl: string, runId: string): VideoLog {
  return {
    videoId,
    sourceUrl,
    runId,
    timestamps: { startedAt: new Date().toISOString() },
    llm_calls: [],
    events: [],
  };
}

export function logEvent(log: VideoLog, message: string) {
  log.events ??= [];
  log.events.push({ timestamp: new Date().toISOString(), message });
}

export async function flushVideoLog(logDir: string, log: VideoLog) {
  log.timestamps.finishedAt = new Date().toISOString();
  const file = path.join(logDir, `${log.videoId}.log.json`);
  await writeFile(file, JSON.stringify(log, null, 2), "utf-8");
}
