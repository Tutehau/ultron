"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface ChatLine {
  role: "user" | "ultron";
  text: string;
}

export default function UltronChat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const [voice, setVoice] = useState(true);
  const [lines, setLines] = useState<ChatLine[]>([
    { role: "ultron", text: "SYSTÈMES EN LIGNE. JE SUIS ULTRON. QUE PUIS-JE FAIRE POUR VOUS ?" },
  ]);
  const logRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<{
    stop: () => void;
  } | null>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines, busy]);

  const speak = useCallback((text: string) => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "fr-FR";
    utterance.rate = 1.05;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setLines((l) => [...l, { role: "user", text }]);
    setBusy(true);
    let acc = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: text }] }),
      });
      if (!res.ok || !res.body) {
        const err = await res.text().catch(() => "");
        setLines((l) => [...l, { role: "ultron", text: `ERREUR ${res.status}: ${err.slice(0, 220)}` }]);
        setBusy(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        setLines((l) => {
          const copy = [...l];
          const last = copy[copy.length - 1];
          if (last?.role === "ultron") {
            copy[copy.length - 1] = { role: "ultron", text: acc };
          } else {
            copy.push({ role: "ultron", text: acc });
          }
          return copy;
        });
      }
      if (voice && acc.trim()) speak(acc);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLines((l) => [...l, { role: "ultron", text: `ERREUR: ${message}` }]);
    } finally {
      setBusy(false);
    }
  }, [input, busy, voice, speak]);

  const toggleMic = useCallback(() => {
    const win = window as unknown as {
      SpeechRecognition?: unknown;
      webkitSpeechRecognition?: unknown;
    };
    const SR = win.SpeechRecognition ?? win.webkitSpeechRecognition;
    if (!SR) {
      setLines((l) => [...l, { role: "ultron", text: "MICRO NON SUPPORTÉ PAR CE NAVIGATEUR." }]);
      return;
    }
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    type RecType = {
      lang: string;
      interimResults: boolean;
      onresult: (e: { results: { 0: { 0: { transcript: string } } } }) => void;
      onend: () => void;
      onerror: (e: { error?: string }) => void;
      start: () => void;
      stop: () => void;
    };
    const rec = new (SR as new () => RecType)();
    rec.lang = "fr-FR";
    rec.interimResults = false;
    rec.onresult = (e) => {
      setInput(e.results[0][0].transcript);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }, [listening]);

  return (
    <>
      <button
        type="button"
        className={`hud-btn ultron-toggle${open ? " active" : ""}`}
        aria-pressed={open}
        onClick={() => setOpen((o) => !o)}
      >
        ULTRON IA
      </button>

      {open && (
        <div className="ultron-panel">
          <div ref={logRef} className="ultron-log">
            {lines.map((line, i) => (
              <div key={i} className={`ultron-line ${line.role}`}>
                <span className="ultron-who">{line.role === "user" ? "VOUS" : "ULTRON"}</span>
                {line.text}
              </div>
            ))}
            {busy && <div className="ultron-line ultron">▍</div>}
          </div>
          <form
            className="ultron-input-row"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <button
              type="button"
              className={`hud-btn ultron-mic${listening ? " on" : ""}`}
              onClick={toggleMic}
              title="Micro"
            >
              {listening ? "●" : "MIC"}
            </button>
            <input
              className="ultron-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Parlez à ULTRON…"
              disabled={busy}
            />
            <button type="submit" className="hud-btn ultron-send" disabled={busy || !input.trim()}>
              ENVOYER
            </button>
          </form>
          <div className="ultron-voice-row">
            <button
              type="button"
              className="hud-btn ultron-voice"
              aria-pressed={voice}
              onClick={() => {
                setVoice((v) => {
                  if (v) window.speechSynthesis?.cancel();
                  return !v;
                });
              }}
            >
              {voice ? (speaking ? "PAROLE…" : "PAROLE ON") : "PAROLE OFF"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
