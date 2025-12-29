import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// project root = one level above src/
const PROJECT_ROOT = path.resolve(__dirname, "..");

export async function loadPrompt(name: string, vars: Record<string, string>): Promise<string> {
  const file = path.join(PROJECT_ROOT, "prompts", `${name}.md`);
  let text = await readFile(file, "utf-8");

  for (const [key, value] of Object.entries(vars)) {
    text = text.replaceAll(`{{${key}}}`, value);
  }

  return text;
}
