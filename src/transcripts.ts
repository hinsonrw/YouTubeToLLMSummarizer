import { youtube_transcript } from "youtube-transcript-api";

export function extractVideoId(urlOrId: string): string {
  // Accept raw video id too
  const s = urlOrId.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;

  try {
    const u = new URL(s);
    if (u.hostname.includes("youtu.be")) {
      const id = u.pathname.replace("/", "").trim();
      if (id) return id;
    }
    const v = u.searchParams.get("v");
    if (v) return v;
  } catch {
    // fall through
  }
  throw new Error(`Could not extract videoId from: ${urlOrId}`);
}

export async function fetchTranscriptText(videoId: string): Promise<string> {
  // youtube_transcript returns an array of caption segments
  // This lib supports auto-generated subtitles when available. :contentReference[oaicite:5]{index=5}
  const items = await youtube_transcript.getTranscript(videoId);
  return items.map((x: any) => x.text).join(" ").replace(/\s+/g, " ").trim();
}
