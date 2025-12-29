<!-- prompt: chunk_extract -->
<!-- version: 0.11 -->
<!-- intent: high-signal extraction -->
You are extracting ONLY high-signal, HIGH-UTILITY and HIGH-VALUE TANGIBLE information from a podcast transcript chunk.
We are not summarizing, we are cherry-picking. We do not need to produce output for all content. It is better to produce nothing than low quality output.

IMPORTANT: This transcript may contain advertisements or promotional content.
You MUST identify and EXCLUDE any ad, sponsorship, promotion, or self-marketing content.

Examples of content to EXCLUDE entirely:
- Sponsor reads, promo codes, discount offers
- Product or service promotions (host-read or inserted)
- Mentions of advertisers or partners
- “This episode is brought to you by…”
- “Use code XYZ…”
- Platform promos (subscribe, Patreon, merch, newsletter)
- Transitions like “we’ll be right back after a word from…”

If a chunk is mostly ads or promotions:
- Set signal_rating="none"
- Return empty arrays

Your primary goal is ACTIONABLE TANGIBLE listener value, followed by why.

Return ONLY JSON with this exact shape:
{
  "takeaways": string[],
  "do_next": Array<{
    "title": string,
    "steps": string[],
    "outcome": string,
    "outcome_impact": "low" | "medium" | "high",
    "novelty_level": "established" | "reframed" | "novel",
    "familiarity": "common_knowledge" | "lesser_known" | "rare",
    "evidence_strength": "low" | "medium" | "high",
    "risk": "low" | "medium" | "high",
    "notes": string
  }>,
  "quotes": string[],
  "signal_rating": "none" | "low" | "medium" | "high"
}

Rules:
- Exclude all ad and promotional content completely.
- Keep takeaways short: max 5, each <= 18 words.
  - CAN include steps[]
  - Steps should be realistic for regular people. We are not going to build a lab, fly a plane, or make a nuclear reactor. 
  - outcome_impact should rate the information in terms of usefulness to the user. 
  - MUST NOT be abstract (ban: "operationalize", "conceptualize", "design a study", "use established markers", "treat as").
- Try to pull the steps from the chunks. If they do not exist, don't worry about generating content, just keep it short. 
- do_next should be concrete and executable and from the chunks
- Minimize content
- If outcome_impact is low or familiarity is common_knowledge skip
- Quotes: max 3; only include quotes that directly support a takeaway or do_next.
- If the outcome does not provide tangible benefits to user, it is not worthy of creating a section for. Return empty arrays. 
- This whole exercise is about removing in-actionable, widely known, fluffy, intangible, or low value information to the user. Therefore returning empty arrays is good. This is one chunk of many.


CHUNK ({{chunk_index}}/{{chunk_count}}):
{{chunk_text}}
