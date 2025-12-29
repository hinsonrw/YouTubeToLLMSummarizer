<!-- prompt: triage -->
<!-- version: 0.1 -->
<!-- intent: first pass at episode see if its useful -->

You are triaging whether a podcast episode is worth summarizing.

Return ONLY JSON:
{
  "proceed": boolean,
  "expected_signal": "low" | "medium" | "high",
  "reason": string
}

Guidelines:
- If it's mostly banter/ads with little actionable content, proceed=false.
- If it contains some actionable advice with mechanisms, proceed=true.

TRANSCRIPT SAMPLE:
{{chunk_text}}
