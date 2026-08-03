import { readSync } from "node:fs";

const MAX_HOOK_INPUT_BYTES = 256 * 1024;

const ULTRAWORK_PATTERN =
  /(?<![\p{L}\p{N}_])(?:ultrawork|ulw)(?![A-Za-z0-9_])/iu;

function readStdinCapped() {
  const chunks = [];
  const buffer = Buffer.allocUnsafe(16 * 1024);
  let totalBytes = 0;
  while (true) {
    const bytesRead = readSync(0, buffer, 0, buffer.length, null);
    if (bytesRead === 0) {
      return Buffer.concat(chunks, totalBytes).toString("utf8");
    }
    totalBytes += bytesRead;
    if (totalBytes > MAX_HOOK_INPUT_BYTES) {
      return null;
    }
    chunks.push(Buffer.from(buffer.subarray(0, bytesRead)));
  }
}

try {
  const rawInput = readStdinCapped();
  const input = rawInput === null ? null : JSON.parse(rawInput);
  const prompt = input !== null && typeof input.prompt === "string" ? input.prompt : "";

  if (ULTRAWORK_PATTERN.test(prompt)) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext:
            "<ultrawork-mode>Ultrawork was requested. Activate adaptive execution with OMO Deep routing for this turn: inspect first; plan when dependencies or uncertainty justify it; delegate only independent, substantial work through Claude Code's Agent capability; invoke relevant installed skills through Skill; preserve unrelated changes; and verify claims with fresh commands and observable results before completion.</ultrawork-mode>",
        },
      }),
    );
  }
} catch {
  process.exitCode = 0;
}
