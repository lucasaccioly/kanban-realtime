// Groq's OpenAI-compatible API, called with plain fetch (no SDK). The key never leaves the server.
const URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_MODEL = "llama-3.1-8b-instant"; // small, fast Llama on Groq's free tier

export type ChatMessage = { role: "system" | "user"; content: string };

export async function groqChat(messages: ChatMessage[]): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY is not set");
  const res = await fetch(URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: process.env.GROQ_MODEL ?? DEFAULT_MODEL, messages, max_tokens: 400, temperature: 0.4 }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Groq responded ${res.status}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Groq returned no content");
  return text;
}
