import { useState, useEffect, useRef } from "react";
import { X, Send, Loader2, ArrowRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:8001";

const WELCOME_MESSAGE = {
  role: "assistant",
  content:
    "Hi! I'm the UniVicoustic assistant. Ask me anything about our acoustic panels — products, sizes, specs, or how to use the configurator.",
};

// Maps product keywords → configurator URL slug + chip label + optional surface type
const PRODUCT_CHIPS = [
  { regex: /\b(flat\s+panel|flat\s+vmt|flat_pet|flat\s+pet)\b/i, slug: "flat-embossed-vmd", label: "Flat VMT", surfaceType: "flat" },
  { regex: /\b(embossed\s+vmt|embossed\s+panel|embossed_pet)\b/i, slug: "flat-embossed-vmd", label: "Embossed VMT", surfaceType: "embossed" },
  { regex: /\b(vicstrip|vic\s+strip|groove|grooving|grooved)\b/i, slug: "vicstrip", label: "VicStrip", surfaceType: null },
  { regex: /\b(ombre|ombrè|ombré|signature\s+ombre)\b/i, slug: "ombre", label: "Signature Ombré", surfaceType: null },
  { regex: /\b(wood\s+panel|wood\s+acoustic|perforated\s+wood)\b/i, slug: "wood", label: "Woodscape", surfaceType: null },
  { regex: /\b(designer\s+textile|color\s+core|colour\s+core|fabric\s+panel)\b/i, slug: "fabrics", label: "Fabrics" },
];

function getProductChips(text) {
  const seen = new Set();
  return PRODUCT_CHIPS.filter(({ regex, slug, surfaceType }) => {
    const key = slug + (surfaceType ?? "");
    if (regex.test(text) && !seen.has(key)) { seen.add(key); return true; }
    return false;
  });
}

// Client-side rate limit: max messages per window
const RATE_LIMIT = 10;
const RATE_WINDOW_MS = 60_000;

export default function ChatWidget({ open, onClose }) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [rateCooldown, setRateCooldown] = useState(0); // seconds until next message allowed
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const sendTimestamps = useRef([]); // rolling window of send times
  const cooldownTimer = useRef(null);

  // Scroll to bottom when messages change
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading || rateCooldown > 0) return;

    // Client-side rate limit check
    const now = Date.now();
    sendTimestamps.current = sendTimestamps.current.filter(t => now - t < RATE_WINDOW_MS);
    if (sendTimestamps.current.length >= RATE_LIMIT) {
      const oldestInWindow = sendTimestamps.current[0];
      const msUntilFree = RATE_WINDOW_MS - (now - oldestInWindow);
      const secsUntilFree = Math.ceil(msUntilFree / 1000);
      setRateCooldown(secsUntilFree);
      clearInterval(cooldownTimer.current);
      cooldownTimer.current = setInterval(() => {
        setRateCooldown(prev => {
          if (prev <= 1) { clearInterval(cooldownTimer.current); return 0; }
          return prev - 1;
        });
      }, 1000);
      return;
    }
    sendTimestamps.current.push(now);
    const userMessage = { role: "user", content: text };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`${BACKEND_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: updatedMessages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Error ${res.status}`);
      }

      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.reply },
      ]);
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed bottom-24 right-6 z-[400] flex flex-col shadow-2xl rounded-2xl overflow-hidden"
      style={{
        width: 360,
        height: 500,
        background: "white",
        border: "1px solid hsl(215,16%,87%)",
      }}
      data-testid="chat-widget"
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ background: "#f8f7f7" }}
      >
        <div className="flex items-center gap-2">
          <img
            src="/chat-icon.png"
            alt=""
            className="w-10 h-10 object-contain"
            aria-hidden="true"
          />
          <div>
            <p className="text-black/80 font-mono font-semibold text-md leading-tight">

              UNIVICOUSTIC Assistant
            </p>
            <p className="text-black/70 text-[11px]">Ask about our panels</p>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close chat"
          className="text-white/80 hover:text-white transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 min-h-0">
        {messages.map((msg, i) => {
          const chips = msg.role === "assistant" ? getProductChips(msg.content) : [];
          return (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div className={msg.role === "assistant" ? "flex flex-col items-start max-w-[80%]" : "max-w-[80%]"}>
                <div
                  className={`rounded-2xl px-3 py-2 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "text-white rounded-br-sm whitespace-pre-wrap"
                      : "text-[hsl(215,25%,27%)] rounded-bl-sm"
                  }`}
                  style={{
                    background:
                      msg.role === "user"
                        ? "hsl(9, 57%, 56%)"
                        : "hsl(215,16%,94%)",
                  }}
                >
                  {msg.role === "user" ? (
                    msg.content
                  ) : (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      components={{
                        p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                        ul: ({ children }) => <ul className="list-disc pl-4 mb-1 space-y-0.5">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal pl-4 mb-1 space-y-0.5">{children}</ol>,
                        li: ({ children }) => <li>{children}</li>,
                        strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                        a: ({ href, children }) => (
                          <a href={href} target="_blank" rel="noopener noreferrer" className="underline text-accent">{children}</a>
                        ),
                        code: ({ children }) => <code className="bg-black/10 px-1 rounded text-xs">{children}</code>,
                      }}
                    >
                      {msg.content}
                    </ReactMarkdown>
                  )}
                </div>
                {chips.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5 px-1">
                    {chips.map(({ slug, label, surfaceType }) => (
                      <button
                        key={slug + (surfaceType ?? "")}
                        onClick={() => {
                          onClose();
                          navigate(`/${slug}`, surfaceType ? { state: { surfaceType } } : undefined);
                        }}
                        className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border transition-colors hover:bg-accent hover:text-white hover:border-transparent"
                        style={{ borderColor: "hsl(var(--accent))", color: "hsl(var(--accent))" }}
                      >
                        Explore {label} <ArrowRight className="h-3 w-3" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {loading && (
          <div className="flex justify-start">
            <div
              className="flex items-center gap-1.5 rounded-2xl rounded-bl-sm px-3 py-2"
              style={{ background: "hsl(215,16%,94%)" }}
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[hsl(215,16%,47%)]" />
              <span className="text-xs text-[hsl(215,16%,47%)]">Thinking…</span>
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-center">
            <p className="text-xs text-red-500 bg-red-50 px-3 py-1.5 rounded-lg">
              {error}
            </p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div
        className="flex flex-col gap-1.5 px-3 py-3 flex-shrink-0 border-t"
        style={{ borderColor: "hsl(215,16%,87%)" }}
      >
        {rateCooldown > 0 && (
          <p className="text-xs text-center text-amber-600 bg-amber-50 rounded-lg px-2 py-1">
            Slow down — wait {rateCooldown}s before sending again.
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question…"
            rows={1}
            maxLength={500}
            disabled={loading || rateCooldown > 0}
            className="flex-1 resize-none rounded-xl border px-3 py-2 text-sm focus:outline-none focus:ring-2 disabled:opacity-50"
            style={{
              borderColor: "hsl(215,16%,87%)",
              maxHeight: 96,
              lineHeight: "1.4",
              focusRingColor: "hsl(var(--accent))",
            }}
            onInput={(e) => {
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 96)}px`;
            }}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading || rateCooldown > 0}
            aria-label="Send message"
            className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-opacity disabled:opacity-40"
            style={{ background: "hsl(var(--accent))" }}
          >
            <Send className="h-4 w-4 text-white" />
          </button>
        </div>
      </div>
    </div>
  );
}
