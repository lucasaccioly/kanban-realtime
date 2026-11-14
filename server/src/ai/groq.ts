// Groq's OpenAI-compatible API, called with plain fetch (no SDK). The key never leaves the server.
const URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "openai/gpt-oss-20b"; // Groq's suggested replacement after llama-3.1-8b-instant was retired (Aug 2026)

export type ChatMessage = { role: "system" | "user"; content: string };

export async function groqChat(messages: ChatMessage[]): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set");
  const res = await fetch(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: process.env.GROQ_MODEL ?? DEFAULT_MODEL,
      messages,
      // reasoning tokens count against the cap: low effort, trace hidden
      reasoning_effort: "low",
      include_reasoning: false,
      max_completion_tokens: 1024,
      temperature: 0.4,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Groq responded ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  // the panel renders plain text, so drop markdown bold and heading marks the model tends to add
  const text = body.choices?.[0]?.message?.content?.replace(/\*\*|^#+\s*/gm, "").trim();
  if (!text) throw new Error("Groq returned no content");
  return text;
}
