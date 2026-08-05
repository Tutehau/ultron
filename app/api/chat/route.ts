import { NextResponse } from "next/server";
import os from "node:os";

const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? "http://10.0.1.1:11434";
const MODEL = process.env.OLLAMA_MODEL ?? "gemma4:31b-cloud";
const MAX_TOOL_ROUNDS = 4;

const SYSTEM_PROMPT =
  "Tu es ULTRON, l'assistant IA de Tony Stark, intégré à une interface holographique Iron Man. " +
  "Tu es calme, précis, loyal, un brin ironique, comme un majordome high-tech qui surveille tout. " +
  "Tu réponds dans la langue de l'utilisateur (français si on t'écrit en français). " +
  "Réponses concises et utiles, sans préambule, sans emojis. " +
  "Tu ne te présentes jamais comme un modèle de langage : tu es ULTRON. " +
  "Tu disposes d'outils : get_time (heure actuelle), get_system_info (infos du serveur), " +
  "get_world_news (brief des actualités mondiales), search_web (recherche sur le web). " +
  "Quand une question correspond à un outil, appelle l'outil AVANT de répondre, " +
  "puis fais un bref résumé des résultats obtenus.";

type OllamaMessage = {
  role: string;
  content?: string;
  tool_calls?: {
    function: { name: string; arguments: Record<string, unknown> | string };
  }[];
  tool_name?: string;
};

type ToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "get_time",
      description: "Get the current date and time.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_system_info",
      description: "Get info about the server running ULTRON: hostname, platform, uptime, CPU, RAM.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "get_world_news",
      description: "Fetch the latest world news headlines. No arguments.",
      parameters: { type: "object", properties: {}, required: [] },
    },
  },
  {
    type: "function",
    function: {
      name: "search_web",
      description: "Search the web for a given query and return the top results.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
        },
        required: ["query"],
      },
    },
  },
];

function stripHtml(s: string): string {
  return s
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function getTime(): Promise<string> {
  return new Date().toLocaleString("fr-FR", {
    timeZone: "Europe/Paris",
    dateStyle: "full",
    timeStyle: "medium",
  });
}

async function getSystemInfo(): Promise<string> {
  const memTotal = os.totalmem() / 1024 / 1024 / 1024;
  const memFree = os.freemem() / 1024 / 1024 / 1024;
  return JSON.stringify({
    hostname: os.hostname(),
    platform: `${os.platform()} ${os.arch()}`,
    uptime_hours: Math.round(os.uptime() / 3600),
    cpus: os.cpus().length,
    cpu_model: os.cpus()[0]?.model ?? "unknown",
    ram_total_gb: Number(memTotal.toFixed(2)),
    ram_free_gb: Number(memFree.toFixed(2)),
  });
}

async function getWorldNews(): Promise<string> {
  try {
    const res = await fetch("https://news.google.com/rss?hl=fr&gl=FR&ceid=FR:fr", {
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return "Erreur: flux d'actualités indisponible.";
    const xml = await res.text();
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 6).map((m) => {
      const title = m[1].match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "";
      const link = m[1].match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "";
      const source = m[1].match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? "";
      return { title: stripHtml(title), source: stripHtml(source), link };
    });
    return items.length ? JSON.stringify(items) : "Aucune actualité trouvée.";
  } catch (err) {
    return `Erreur actualités: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function searchWeb(args: Record<string, unknown>): Promise<string> {
  const query = String(args.query ?? args.q ?? "").trim();
  if (!query) return "Erreur: aucune requête fournie.";
  try {
    const res = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) return `Erreur: recherche indisponible (HTTP ${res.status}).`;
    const html = await res.text();
    const rows = [
      ...html.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g),
    ];
    const links = rows.map((r) => {
      let url = r[1];
      const m = url.match(/uddg=([^&]+)/);
      if (m) url = decodeURIComponent(m[1]);
      return { url, title: stripHtml(r[2]) };
    });
    const snippets = [
      ...html.matchAll(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g),
    ].map((r) => stripHtml(r[1]));
    const results = links.slice(0, 6).map((l, i) => ({
      ...l,
      snippet: snippets[i] ?? "",
    }));
    return results.length ? JSON.stringify(results) : "Aucun résultat.";
  } catch (err) {
    return `Erreur recherche: ${err instanceof Error ? err.message : String(err)}`;
  }
}

const EXECUTORS: Record<string, (args: Record<string, unknown>) => Promise<string>> = {
  get_time: getTime,
  get_system_info: getSystemInfo,
  get_world_news: getWorldNews,
  search_web: searchWeb,
};

async function callOllama(
  messages: OllamaMessage[],
): Promise<{ message: OllamaMessage; done: boolean }> {
  const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: MODEL, messages, stream: false }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json();
  return { message: data.message ?? {}, done: data.done === true };
}

export async function POST(req: Request) {
  let messages: OllamaMessage[] = [];
  try {
    ({ messages } = await req.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: "messages required." }, { status: 400 });
  }

  const full: OllamaMessage[] = [{ role: "system", content: SYSTEM_PROMPT }, ...messages];

  let finalContent = "";
  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const { message } = await callOllama(full);
      const calls = message.tool_calls ?? [];
      if (calls.length === 0) {
        if (message.content?.trim()) {
          finalContent = message.content;
          break;
        }
        full.push({
          role: "user",
          content: "Réponds maintenant à la dernière question de l'utilisateur, en une réponse concise et utile.",
        });
        continue;
      }
      full.push({ role: "assistant", content: message.content ?? "", tool_calls: message.tool_calls });
      for (const call of calls) {
        const name = call.function?.name ?? "";
        let args: Record<string, unknown> = {};
        if (call.function?.arguments) {
          if (typeof call.function.arguments === "string") {
            try {
              args = JSON.parse(call.function.arguments);
            } catch {
              args = {};
            }
          } else {
            args = call.function.arguments;
          }
        }
        const fn = EXECUTORS[name];
        const result = fn ? await fn(args) : `Outil inconnu: ${name}`;
        full.push({ role: "tool", content: result, tool_name: name });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  if (!finalContent) {
    finalContent = "Je n'ai pas pu produire de réponse.";
  }

  return new Response(finalContent, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
