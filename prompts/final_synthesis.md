<!-- prompt: final_synthesis -->
<!-- version: 0.1 -->
<!-- intent: high-signal extraction -->
You are given extracted high-signal items from many podcast transcript chunks.

Hard requirements:
- key_takeaways MUST be an array (can be empty).
- behavior_changes MUST be an array

- Each behavior_changes item MUST include: change, why_mechanism, how_to_apply, evidence_strength.
- If unsure, put "how_to_apply" as a practical next step (even if generic).
- Output ONLY valid JSON. No markdown. No commentary.

IMPORTANT:
- Do NOT include advertisements, sponsors, promo codes, or promotions.
- If the episode contains significant ad content, mention that as a quality issue but do not repeat the ads.

Your goals:
1) Provide an overall summary.
2) Provide the most actionable behavior changes.
3) For each behavior change, include mechanistic "why this works" explanations.
4) Rate evidence strength (low/medium/high) based on how the speaker frames it (study-backed vs speculation). If unclear, choose "medium" and add a caution.
5) Keep it practical.
6) Deduplicate overlapping ideas.

Return STRICT JSON matching this schema:
{{schema}}

SOURCE URL: {{source_url}}

CHUNK EXTRACTIONS:
{{chunk_extractions}}
