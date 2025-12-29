import path from "node:path";
import OpenAI from "openai";
import { z } from "zod";
import "dotenv/config";

import { readFile, mkdir, writeFile, readdir } from "node:fs/promises";
import { loadManifest, saveManifest, sha256, shouldSkip, upsertEntry } from "./manifest";
import { loadPrompt } from "./prompts";
import { initRunLog, createVideoLog, flushVideoLog, logEvent, type VideoLog } from "./logger";
import { appendFile, readFile as readFsFile, writeFile as writeFsFile } from "node:fs/promises";


const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
if (!process.env.OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY. Run: export OPENAI_API_KEY=...");
}

const CHUNK_MODEL = process.env.CHUNK_MODEL || "gpt-4o-mini";
const FINAL_MODEL = process.env.FINAL_MODEL || "gpt-4o-mini";

function extractJsonObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text;
}


type ChunkRecord = {
  chunkIndex: number;
  totalChunks: number;
  extractedText: string;     // model output (usually JSON)
  parsed?: any;              // parsed JSON if possible
  ts: string;
};

type Checkpoint = {
  videoId: string;
  transcript_sha256: string;
  config_sha256: string;
  totalChunks: number;
  completedChunkCount: number;
  updatedAt: string;
};

async function readJsonIfExists<T>(p: string): Promise<T | null> {
  try {
    const raw = await readFsFile(p, "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function loadChunkRecords(jsonlPath: string): Promise<ChunkRecord[]> {
  try {
    const raw = await readFsFile(jsonlPath, "utf-8");
    const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
    return lines.map(l => JSON.parse(l) as ChunkRecord);
  } catch {
    return [];
  }
}

function safeParseJson(text: string): any | null {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    const jsonText = start >= 0 && end > start ? text.slice(start, end + 1) : text;
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

async function computeConfigSha(): Promise<string> {
  // Load raw prompt files so edits automatically trigger re-runs
  const p1 = await loadPrompt("triage", { chunk_text: "X" }).catch(() => "");
  const p2 = await loadPrompt("ad_filter", { chunk_text: "X" }).catch(() => "");
  const p3 = await loadPrompt("chunk_extract", {
    chunk_index: "1",
    chunk_count: "1",
    chunk_text: "X",
  });
  const p4 = await loadPrompt("final_synthesis", {
    schema: SummarySchema.toString(),
    source_url: "X",
    chunk_extractions: "X",
  });

  // Also include model+chunking params
  const configBlob = JSON.stringify({
    models: { chunk: CHUNK_MODEL, final: FINAL_MODEL },
    chunking: { maxChars: 10000, overlap: 1000 },
    prompts: { triage: p1, ad_filter: p2, chunk_extract: p3, final_synthesis: p4 },
    manifestVersion: 1,
  });

  return sha256(configBlob);
}


const SummarySchema = z.object({
  title: z.string().optional(),
  overall_summary: z.string(),
  key_takeaways: z.array(z.string()).max(1000),
  behavior_changes: z
    .array(
      z.object({
        change: z.string(),
        why_mechanism: z.string(),
        how_to_apply: z.string(),
        evidence_strength: z.enum(["low", "medium", "high"]),
        time_to_try: z.string().optional(),
        cautions: z.string().optional(),
      })
    )
    .max(1000),
  notable_quotes: z.array(z.string()).max(10).optional(),
});


function chunkText(s: string, maxChars = 10000, overlap = 1000): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < s.length) {
    const end = Math.min(i + maxChars, s.length);
    chunks.push(s.slice(i, end));
    if (end === s.length) break;
    i = end - overlap;
    if (i < 0) i = 0;
  }
  return chunks;
}

async function extractChunk(chunk: string, i: number, total: number, log: VideoLog) {
  const prompt = await loadPrompt("chunk_extract", {
    chunk_index: String(i + 1),
    chunk_count: String(total),
    chunk_text: chunk,
  });

  const resp = await client.responses.create({
    model: CHUNK_MODEL,
    input: prompt,
  });

  const out = resp.output_text?.trim() ?? "";

  log.llm_calls.push({
    stage: "chunk_summary",
    chunkIndex: i,
    model: "gpt-5-mini",
    prompt,
    response: out,
    timestamp: new Date().toISOString(),
  });

  return out;
}

async function synthesizeFinal(chunkExtractions: unknown, sourceUrl: string, log: VideoLog) {
  const prompt = await loadPrompt("final_synthesis", {
    schema: SummarySchema.toString(),
    source_url: sourceUrl,
    chunk_extractions: JSON.stringify(chunkExtractions, null, 2),
  });

  const resp = await client.responses.create({
    model: FINAL_MODEL,
    input: prompt,
  });

  const out = resp.output_text?.trim() ?? "";

  log.llm_calls.push({
    stage: "final_synthesis",
    model: "gpt-5",
    prompt,
    response: out,
    timestamp: new Date().toISOString(),
  });

  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  const jsonText = start >= 0 && end > start ? out.slice(start, end + 1) : out;

  return SummarySchema.parse(JSON.parse(jsonText));
}


function toMarkdown(s: z.infer<typeof SummarySchema>, sourceUrl: string): string {
  const lines: string[] = [];
  lines.push(`# Podcast summary`);
  lines.push(`Source: ${sourceUrl}`);
  lines.push(``);
  lines.push(`## Overall summary`);
  lines.push(s.overall_summary);
  lines.push(``);
  lines.push(`## Key takeaways`);
  for (const t of s.key_takeaways) lines.push(`- ${t}`);
  lines.push(``);
  lines.push(`## Behavior changes (action + mechanism)`);
  for (const b of s.behavior_changes) {
    lines.push(`### ${b.change}`);
    lines.push(`- **Why (mechanism):** ${b.why_mechanism}`);
    lines.push(`- **How to apply:** ${b.how_to_apply}`);
    lines.push(`- **Evidence strength:** ${b.evidence_strength}`);
    if (b.time_to_try) lines.push(`- **Time to try:** ${b.time_to_try}`);
    if (b.cautions) lines.push(`- **Cautions:** ${b.cautions}`);
    lines.push(``);
  }
  return lines.join("\n");
}
async function main() {
  function getArg(prefix: string): string | null {
    const hit = process.argv.find((a) => a.startsWith(prefix));
    return hit ? hit.slice(prefix.length) : null;
  }

  const maxChunksArg = getArg("--max-chunks=");
  const maxChunks = maxChunksArg ? Math.max(1, Number(maxChunksArg)) : Infinity;
  const force = process.argv.includes("--force");

  await mkdir("out", { recursive: true });

  const manifest = await loadManifest();
  const configSha = await computeConfigSha();

  const runId = new Date().toISOString().slice(0, 10);
  const logDir = await initRunLog(runId);

  const files = (await readdir("data")).filter((f) => f.endsWith(".json"));
  console.log(`▶ Found ${files.length} transcript file(s) in ./data`);
  if (files.length === 0) {
    console.log("❌ No transcripts found. Run: npm run pull");
    return;
  }

  for (const f of files) {
    const raw = await readFile(path.join("data", f), "utf-8");
    const data = JSON.parse(raw) as { videoId: string; sourceUrl: string; transcript: string };

    console.log(`▶ Summarizing videoId=${data.videoId} ...`);

    const outJsonPath = path.join("out", `${data.videoId}.summary.json`);
    const outMdPath = path.join("out", `${data.videoId}.md`);

    const log = createVideoLog(data.videoId, data.sourceUrl, runId);
    log.transcript = { charCount: data.transcript.length, text: data.transcript };

    const transcriptSha = sha256(data.transcript);

    if (!force && shouldSkip(manifest, data.videoId, transcriptSha, configSha)) {
      console.log(`⏭️  Skipping videoId=${data.videoId} (no changes)`);
      logEvent(log, "skip", { reason: "no_changes", transcriptSha, configSha });
      await flushVideoLog(logDir, log);
      continue;
    }

    const chunks = chunkText(data.transcript, 10000, 1000);
    const chunksToProcess = Math.min(chunks.length, maxChunks);
    console.log(`  - ${chunks.length} chunk(s) total; processing ${chunksToProcess}`);

    // Checkpoint files
    const jsonlPath = path.join("out", `${data.videoId}.chunks.jsonl`);
    const checkpointPath = path.join("out", `${data.videoId}.checkpoint.json`);

    const existingCheckpoint = await readJsonIfExists<Checkpoint>(checkpointPath);
    const existingChunks = await loadChunkRecords(jsonlPath);

    // If transcript/config changed, ignore prior chunks (and recommend deleting)
    if (
      existingCheckpoint &&
      (existingCheckpoint.transcript_sha256 !== transcriptSha || existingCheckpoint.config_sha256 !== configSha)
    ) {
      console.log(`  ⚠ Checkpoint exists but transcript/prompts changed. Starting fresh.`);
      console.log(`    - Delete these to avoid confusion:`);
      console.log(`      rm -f ${jsonlPath} ${checkpointPath}`);
      // We'll ignore old ones by not seeding from them.
    }

    const doneIdx = new Set<number>();
    const chunkExtractions: any[] = new Array(chunks.length);

    // Seed from disk ONLY if checkpoint matches
    if (
      existingCheckpoint &&
      existingCheckpoint.transcript_sha256 === transcriptSha &&
      existingCheckpoint.config_sha256 === configSha
    ) {
      for (const r of existingChunks) {
        doneIdx.add(r.chunkIndex);
        chunkExtractions[r.chunkIndex] =
          r.parsed ?? safeParseJson(r.extractedText) ?? { raw: r.extractedText };
      }
      console.log(`  - already have ${doneIdx.size}/${chunks.length} chunk(s) saved to disk`);
    } else {
      console.log(`  - no usable checkpoint found; starting from scratch`);
    }

    // Process chunks in parallel
    const chunksToExtract = Array.from({ length: chunksToProcess }, (_, i) => i).filter(i => !doneIdx.has(i));

    console.log(`  - processing ${chunksToExtract.length} chunks in parallel...`);

    await Promise.all(
      chunksToExtract.map(async (i) => {
        console.log(`  - extracting chunk ${i + 1}/${chunksToProcess}`);

        const out = await extractChunk(chunks[i], i, chunks.length, log);
        const parsed = safeParseJson(out);

        const rec: ChunkRecord = {
          chunkIndex: i,
          totalChunks: chunks.length,
          extractedText: out,
          parsed: parsed ?? undefined,
          ts: new Date().toISOString(),
        };

        // Append immediately (Ctrl+C safe)
        await appendFile(jsonlPath, JSON.stringify(rec) + "\n", "utf-8");

        chunkExtractions[i] = parsed ?? { raw: out };
        doneIdx.add(i);

        const cp: Checkpoint = {
          videoId: data.videoId,
          transcript_sha256: transcriptSha,
          config_sha256: configSha,
          totalChunks: chunks.length,
          completedChunkCount: doneIdx.size,
          updatedAt: new Date().toISOString(),
        };
        await writeFsFile(checkpointPath, JSON.stringify(cp, null, 2), "utf-8");

        console.log(`    ✅ saved chunk ${i + 1}/${chunksToProcess} (saved total: ${doneIdx.size})`);
      })
    );

    // Sample mode: stop after N chunks and do NOT synthesize
    if (chunksToProcess < chunks.length) {
      console.log(
        `⚠ Sample mode: processed ${chunksToProcess}/${chunks.length} chunks. Skipping final synthesis.`
      );
      await flushVideoLog(logDir, log);
      continue;
    }

    // If not all chunks are done (e.g., you killed and resumed with maxChunks=Infinity this shouldn't happen,
    // but keep it safe)
    if (doneIdx.size < chunks.length) {
      console.log(`⚠ Incomplete: have ${doneIdx.size}/${chunks.length} chunks. Re-run to resume.`);
      await flushVideoLog(logDir, log);
      continue;
    }

    console.log(`  - synthesizing final summary`);
    let finalJson: z.infer<typeof SummarySchema>;
    try {
      finalJson = await synthesizeFinal(chunkExtractions, data.sourceUrl, log);
    } catch (e) {
      console.log(`  ❌ Final synthesis failed. Writing partial artifacts for debugging.`);
      await writeFile(path.join("out", `${data.videoId}.chunk_extractions.json`), JSON.stringify(chunkExtractions, null, 2), "utf-8");
      throw e;
    }

    await writeFile(outJsonPath, JSON.stringify(finalJson, null, 2), "utf-8");
    await writeFile(outMdPath, toMarkdown(finalJson, data.sourceUrl), "utf-8");

    console.log(`✅ Wrote ${outJsonPath}`);
    console.log(`✅ Wrote ${outMdPath}`);

    upsertEntry(manifest, {
      videoId: data.videoId,
      sourceUrl: data.sourceUrl,
      transcript_sha256: transcriptSha,
      config_sha256: configSha,
      processed_at: new Date().toISOString(),
      outputs: {
        json: outJsonPath,
        md: outMdPath,
        log: path.join(logDir, `${data.videoId}.log.json`),
      },
    });
    await saveManifest(manifest);

    log.final_outputs = {
      summary_json: finalJson,
      summary_markdown: toMarkdown(finalJson, data.sourceUrl),
    };
    await flushVideoLog(logDir, log);
  }
}


main().catch((e) => {
  console.error(e);
  process.exit(1);
});
