import { NextResponse } from "next/server";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? "http://10.0.1.1:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "gemma4:31b-cloud";

const SYSTEM_PROMPT =
  "You are ULTRON, a highly capable AI assistant built into an Iron Man-style interface. " +
  "You are precise, witty, loyal and slightly dry, like a high-tech butler AI. " +
  "Answer in the same language the user writes in (use French if they write French). " +
  "Keep answers concise and useful, no preamble, no emojis. " +
  "You never mention that you are a language model. You are ULTRON.";

export async function POST(req: Request) {
  let messages: { role: string; content: string }[] = [];
  try {
    ({ messages } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages required." }, { status: 400 });
  }

  const upstream = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
      stream: true,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => "");
    return NextResponse.json(
      { error: `Ollama ${upstream.status}: ${text.slice(0, 300)}` },
      { status: 502 },
    );
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let buffer = "";
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("{")) continue;
            try {
              const json = JSON.parse(trimmed);
              const content: string = json.message?.content ?? "";
              if (content) controller.enqueue(encoder.encode(content));
            } catch {
              // ignore malformed lines
            }
          }
        }
      } catch (error) {
        controller.error(error);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
