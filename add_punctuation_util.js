import { generateTextOpenAI } from "./resources_utils.js";
import fs from "fs";


function splitIntoChunks(text, maxTokens = 800) {
  const chunks = [];

  while (chunks.length * maxTokens < text.length) {
    const end = Math.min((chunks.length + 1) * maxTokens, text.length);
    chunks.push(text.slice(chunks.length * maxTokens, end));
    console.log(`Created chunk ending at char ${end}...`);
  }

  return chunks;
}

/**
 * Call Ollama to add punctuation ONLY
 */
async function punctuateChunk(chunk) {
  console.log("Punctuating chunk with Ollama...");
  const message = await generateTextOpenAI([
    {
      role: "system",
      content:
        "You add punctuation only. Do NOT add, remove, or change words. Do NOT add, remove, or change punctuation at the beginning or end of the text. Do NOT explain. Output text only.",
    },
    {
      role: "user",
      content: chunk,
    },
  ],
    "llamacpp",
    "qwen-3.6-35B-general",
  );

  return message.content;
}

/**
 * Clean chunk boundaries before merging
 */
function cleanBoundary(prev, next) {
  if (!prev) return next;

  // Remove leading punctuation artifacts
  next = next.replace(/^[,.;:!?]+\s*/g, "");

  // Ensure proper spacing
  if (!/\s$/.test(prev) && !/^\s/.test(next)) {
    return prev + " " + next;
  }

  return prev + next;
}

/**
 * Main function
 */
export async function punctuateLongText(text) {
  // Create output directory if it doesn't exist
  if (!fs.existsSync("./output")) {
    fs.mkdirSync("./output", { recursive: true });
  }

  const chunks = splitIntoChunks(text, 1000); // Smaller chunks to reduce memory usage
  let result = "";

  for (let i = 0; i < chunks.length; i++) {
    console.log(`Punctuating chunk ${i + 1}/${chunks.length}`);
    const punctuated = await punctuateChunk(chunks[i]);

    // Write each chunk to file for safety
    fs.writeFileSync("./output/output" + i + ".txt", punctuated.trim());

    // Merge with previous content using cleanBoundary
    result = cleanBoundary(result, punctuated);
  }

  // Write final merged result
  fs.writeFileSync("./output/final_output.txt", result.trim().replace(/\s+/g, " "));
  console.log("✓ Complete! Final output written to ./output/final_output.txt");

  return result;
}

punctuateLongText(fs.readFileSync("./input.txt", "utf8"));