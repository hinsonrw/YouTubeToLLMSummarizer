# YoutubeToLLM

Transform YouTube videos into actionable, AI-powered summaries with behavior changes, key takeaways, and mechanistic explanations.

## Features

- **Parallel Processing**: Process multiple transcript chunks simultaneously for fast summarization
- **Intelligent Chunking**: Automatically splits long transcripts into manageable chunks with overlap
- **Checkpoint System**: Resume interrupted processing without losing progress
- **Configurable Models**: Choose between different OpenAI models (gpt-4o-mini, gpt-4o, etc.)
- **High-Quality Output**: Extracts actionable insights, behavior changes, and evidence-based recommendations
- **Multiple Formats**: Generates both JSON and Markdown summaries

## Prerequisites

- Node.js (v18 or higher)
- OpenAI API key
- `yt-dlp` (optional, for fallback transcript fetching)

## Installation

1. Clone the repository:
```bash
git clone <your-repo-url>
cd YoutubeToLLM
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

4. Edit `.env` and add your OpenAI API key:
```
OPENAI_API_KEY=your-api-key-here
```

## Configuration

### Model Selection

By default, the system uses `gpt-4o-mini` (fastest and cheapest). You can change models in `.env`:

```bash
# Fast and economical (recommended for testing)
CHUNK_MODEL=gpt-4o-mini
FINAL_MODEL=gpt-4o-mini

# Higher quality (more expensive)
CHUNK_MODEL=gpt-4o
FINAL_MODEL=gpt-4o
```

Available models:
- `gpt-4o-mini` - Fastest, most economical
- `gpt-4o` - Higher quality, slower
- `gpt-4-turbo` - Legacy option
- `o1-mini`, `o1` - Advanced reasoning models

## Usage

### 1. Add YouTube URLs

Create or edit `links.txt` with one YouTube URL per line:
```
https://www.youtube.com/watch?v=videoId1
https://www.youtube.com/watch?v=videoId2
```

### 2. Pull Transcripts

Download transcripts from YouTube:
```bash
npm run pull
```

This fetches transcripts and saves them to `data/`.

### 3. Generate Summaries

Process all transcripts:
```bash
npm run summarize
```

Or limit to first N chunks (useful for testing):
```bash
npm run summarize -- --max-chunks=5
```

### 4. Run Everything

Pull transcripts and summarize in one command:
```bash
npm run run
```

Force re-process everything (ignores checkpoints):
```bash
npm run run:force
```

## Output

The system generates three types of output in the `out/` directory:

### 1. Summary JSON (`videoId.summary.json`)
Structured data with:
- Overall summary
- Key takeaways
- Behavior changes with mechanisms and evidence strength
- Notable quotes

### 2. Markdown (`videoId.md`)
Human-readable summary formatted for easy reading

### 3. Chunks & Checkpoints
- `videoId.chunks.jsonl` - Individual chunk extractions
- `videoId.checkpoint.json` - Progress tracking for resumption

## How It Works

1. **Transcript Extraction**: Fetches YouTube transcripts via Google's timedtext API or yt-dlp fallback
2. **Chunking**: Splits long transcripts into 10,000-character chunks with 1,000-character overlap
3. **Parallel Processing**: Extracts high-signal information from all chunks simultaneously using OpenAI API
4. **Final Synthesis**: Combines chunk extractions into a cohesive summary with actionable insights
5. **Output Generation**: Produces both JSON and Markdown formats

## Project Structure

```
YoutubeToLLM/
├── src/
│   ├── pull.ts          # Transcript fetching
│   ├── summarize.ts     # Main summarization logic
│   ├── prompts.ts       # Prompt loader
│   ├── manifest.ts      # Processing history tracking
│   └── logger.ts        # Structured logging
├── prompts/             # LLM prompt templates
│   ├── chunk_extract.md
│   ├── final_synthesis.md
│   ├── ad_filter.md
│   └── triage.md
├── data/                # Downloaded transcripts
├── out/                 # Generated summaries
├── logs/                # Processing logs
├── links.txt           # YouTube URLs to process
└── .env                # Configuration (not in git)
```

## Advanced Options

### Resume from Checkpoint

If processing is interrupted, simply run the command again. The system automatically resumes from the last saved checkpoint.

### Sample Mode

Test with limited chunks to validate quality before processing full videos:
```bash
npm run summarize -- --max-chunks=3
```

### Force Reprocessing

Delete checkpoint files to force re-processing:
```bash
rm out/videoId.checkpoint.json out/videoId.chunks.jsonl
npm run summarize
```

## Prompt Customization

Prompts are located in the `prompts/` directory:
- `chunk_extract.md` - Extract insights from individual chunks
- `final_synthesis.md` - Combine chunk extractions into final summary
- `ad_filter.md` - Filter advertisement content
- `triage.md` - Initial content assessment

Edit these files to customize the extraction and summarization behavior. Changes to prompts automatically trigger reprocessing (config hash tracking).

## Cost Optimization

- Use `gpt-4o-mini` for most efficient processing (60x cheaper than GPT-4)
- Test with `--max-chunks=3` before processing full videos
- Parallel processing completes in approximately the time of 1 chunk

## Troubleshooting

### No transcripts found
- Ensure video has captions/subtitles enabled
- Try installing `yt-dlp` for better fallback support

### API errors
- Check your OpenAI API key in `.env`
- Verify you have sufficient API credits

### Missing checkpoint
- Checkpoints are invalidated if prompts or transcripts change
- This is by design to ensure output consistency

## License

ISC

## Author

Richard Hinson (hinsonrwdev@gmail.com)
