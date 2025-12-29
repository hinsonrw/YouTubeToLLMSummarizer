import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";


import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile as readFsFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);



type CaptionTrack = {
  lang_code: string;
  kind?: string;
  name?: string;
};

async function findBestLocalVtt(videoId: string): Promise<string | null> {
  try {
    const files = await readdir("data");
    const vtts = files.filter((f) => f.startsWith(videoId) && f.endsWith(".vtt"));
    if (vtts.length === 0) return null;

    vtts.sort((a, b) => {
      const score = (f: string) => (f.includes(".en") ? 0 : 10) + (f.includes("auto") ? 5 : 0);
      return score(a) - score(b);
    });

    const chosen = vtts[0];
    console.log(`    ✅ Found existing VTT: data/${chosen}`);

    const vtt = await readFsFile(`data/${chosen}`, "utf-8");
    const transcript = vttToText(vtt);
    console.log(`    ✅ Parsed transcript length: ${transcript.length} chars`);
    return transcript.length ? transcript : null;
  } catch {
    return null;
  }
}

async function runYtDlpForSubs(videoId: string, url: string): Promise<string | null> {
  // 0) Prefer already-downloaded VTT to avoid 429s
  const existing = await findBestLocalVtt(videoId);
  if (existing) return existing;

  console.log(`    ▶ Running yt-dlp for subtitles...`);

  const args = [
    "--no-playlist",
    "--skip-download",
    "--write-subs",
    "--write-auto-subs",
    "--sub-langs", "en,en-US,en-GB",
    "--sub-format", "vtt",
    "-o", "data/%(id)s.%(ext)s",
    url,
  ];
  

  try {
    const { stdout, stderr } = await execFileAsync("yt-dlp", args, { maxBuffer: 10 * 1024 * 1024 });
    console.log(`    ▶ yt-dlp stdout head: ${JSON.stringify(stdout.slice(0, 300))}`);
    if (stderr) console.log(`    ▶ yt-dlp stderr head: ${JSON.stringify(stderr.slice(0, 300))}`);
  } catch (e: any) {
    // Important: keep stderr if available (it contains the 429 detail)
    console.log(`    ❌ yt-dlp failed: ${e?.message ?? e}`);
    return null;
  }

  // 1) After download, parse the VTT we just got
  return await findBestLocalVtt(videoId);
}



function parseTrackListXml(xml: string): CaptionTrack[] {
  // Extract attributes from <track ... />
  const tracks: CaptionTrack[] = [];
  const re = /<track\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1] ?? "";
    const getAttr = (k: string) => {
      const mm = new RegExp(`${k}="([^"]*)"`, "i").exec(attrs);
      return mm?.[1];
    };

    const lang_code = getAttr("lang_code");
    if (!lang_code) continue;

    tracks.push({
      lang_code,
      kind: getAttr("kind"),
      name: getAttr("name"),
    });
  }
  return tracks;
}
async function listCaptionTracks(videoId: string): Promise<CaptionTrack[]> {
  const url = `https://video.google.com/timedtext?type=list&v=${encodeURIComponent(videoId)}`;
  const resp = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });

  console.log(`    ▶ type=list status=${resp.status} ok=${resp.ok} url=${url}`);

  const xml = await resp.text();

  // Debug: show first 300 chars so we can see if it's HTML, consent page, empty, etc.
  console.log(`    ▶ type=list body head: ${JSON.stringify(xml.slice(0, 300))}`);
  console.log(`    ▶ type=list body length: ${xml.length}`);

  if (!resp.ok) return [];
  return parseTrackListXml(xml);
}

function vttToText(vtt: string): string {
  // Remove WEBVTT header + timestamps + cue settings
  const lines = vtt.split(/\r?\n/);

  const textLines: string[] = [];
  for (const line of lines) {
    const s = line.trim();
    if (!s) continue;
    if (s === "WEBVTT") continue;

    // timestamps like: 00:00:01.000 --> 00:00:03.000
    if (s.includes("-->")) continue;

    // cue identifiers (sometimes numeric)
    if (/^\d+$/.test(s)) continue;

    // remove tags like <c> or <v Speaker>
    const cleaned = s.replace(/<[^>]+>/g, "").trim();
    if (cleaned) textLines.push(cleaned);
  }

  // De-dup adjacent identical lines (VTT often repeats)
  const deduped: string[] = [];
  for (const t of textLines) {
    if (deduped.length === 0 || deduped[deduped.length - 1] !== t) deduped.push(t);
  }

  return deduped.join(" ").replace(/\s+/g, " ").trim();
}


function extractVideoId(urlOrId: string): string {
  const s = urlOrId.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;

  const u = new URL(s);
  if (u.hostname.includes("youtu.be")) {
    const id = u.pathname.replace("/", "").trim();
    if (!id) throw new Error(`Could not parse youtu.be id from: ${s}`);
    return id;
  }
  const v = u.searchParams.get("v");
  if (!v) throw new Error(`No video id found in: ${s}`);
  return v;
}

// Minimal HTML entity decode for timedtext payloads
function decodeEntities(s: string): string {
  return s
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'")
    .replaceAll("&#x2F;", "/")
    .replaceAll("&#x60;", "`")
    .replaceAll("&#x3D;", "=");
}

function stripXmlText(xml: string): string[] {
  // Matches <text ...>...</text> segments
  // Content can include newlines and entity-encoded punctuation.
  const out: string[] = [];
  const re = /<text\b[^>]*>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const raw = m[1] ?? "";
    // Timedtext uses entities; also occasionally includes <font> tags etc.
    const cleaned = decodeEntities(raw)
      .replace(/<\/?[^>]+>/g, " ") // strip any residual tags inside
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned) out.push(cleaned);
  }
  return out;
}

function xmlToTranscript(xml: string): string | null {
  if (!xml.includes("<text")) return null;
  const parts = stripXmlText(xml);
  if (parts.length === 0) return null;
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

async function fetchTimedTextByTrack(videoId: string, t: CaptionTrack): Promise<string | null> {
  const params = new URLSearchParams({ v: videoId, lang: t.lang_code });
  if (t.kind) params.set("kind", t.kind);
  if (t.name) params.set("name", t.name);

  const url = `https://video.google.com/timedtext?${params.toString()}`;
  const resp = await fetch(url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!resp.ok) return null;

  const xml = await resp.text();
  return xmlToTranscript(xml);
}

async function fetchTranscriptBestEffort(videoId: string) {
  // First: list tracks (this is the key debugging step)
  const tracks = await listCaptionTracks(videoId);

  console.log(
    `    ▶ Track list: ${
      tracks.length
        ? tracks.map(t => `${t.lang_code}${t.kind ? `:${t.kind}` : ""}${t.name ? `:${t.name}` : ""}`).join(", ")
        : "(none)"
    }`
  );

  if (tracks.length === 0) return null;

  // Prefer English-ish first, then non-ASR, then anything
  const preferred = [...tracks].sort((a, b) => {
    const score = (t: CaptionTrack) =>
      (t.lang_code.toLowerCase().startsWith("en") ? 0 : 10) +
      (t.kind === "asr" ? 5 : 0);
    return score(a) - score(b);
  });

  for (const t of preferred) {
    console.log(`    - Trying track lang=${t.lang_code} kind=${t.kind ?? "(none)"} name=${t.name ?? "(none)"}`);
    const txt = await fetchTimedTextByTrack(videoId, t);
    if (txt) {
      return {
        transcript: txt,
        source: `timedtext(track=${t.lang_code}${t.kind ? `,kind=${t.kind}` : ""}${t.name ? `,name=${t.name}` : ""})`,
      };
    }
  }

  return null;
}


export async function main(linksPath = "links.txt") {
  console.log(`▶ pull.ts reading links from: ${linksPath}`);
  console.log(`▶ CWD: ${process.cwd()}`);

  const raw = await readFile(linksPath, "utf-8");
  const urls = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  console.log(`▶ Found ${urls.length} link(s).`);
  if (urls.length === 0) {
    console.log("❌ links file contained 0 usable links. Nothing to do.");
    return;
  }

  await mkdir("data", { recursive: true });

  for (const url of urls) {
    const videoId = extractVideoId(url);
    console.log(`  - Fetching transcript for videoId=${videoId}`);
    // 1) Try timedtext (fast path)
    let result = await fetchTranscriptBestEffort(videoId);

    // 2) Fallback to yt-dlp if timedtext can’t list tracks / fetch captions
    if (!result) {
      console.log(`    ⚠ timedtext unavailable; falling back to yt-dlp for videoId=${videoId}`);
      const transcript = await runYtDlpForSubs(videoId, url);
      if (!transcript) {
        console.log(`    ❌ No captions found via timedtext OR yt-dlp for videoId=${videoId}`);
        continue;
      }
      result = { transcript, source: "yt-dlp(vtt)" };
    }

    const payload = {
      videoId,
      sourceUrl: url,
      fetchedAt: new Date().toISOString(),
      transcriptSource: result.source,
      transcript: result.transcript,
    };

    const outPath = path.join("data", `${videoId}.json`);
    await writeFile(outPath, JSON.stringify(payload, null, 2), "utf-8");
    console.log(`    ✅ wrote ${outPath} (${result.transcript.length} chars) via ${result.source}`);

  }
}

// CLI: tsx src/pull.ts links.txt
if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv[2] ?? "links.txt").catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
