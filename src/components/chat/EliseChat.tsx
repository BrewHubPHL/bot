"use client";

/**
 * EliseChat — Fixed bottom-right chatbot widget for BrewHub PHL.
 *
 * Architecture:
 *   - Dual-Lock Pattern: `chatSubmittingRef` (useRef) + `chatTyping` state.
 *   - Timer Safety: all timeouts tracked via refs, cleared on unmount.
 *   - Voice session refs cleaned up in useEffect return.
 *   - Fixed positioning: always visible above the fold on mobile & desktop
 *     now that the waitlist vertical height is removed.
 *
 * This component receives the shared `supabase` client and `linkify` helper
 * from its parent (BrewHubLandingClient) to avoid duplicating dependencies.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import React from "react";
import { toast, Toaster } from "sonner";
import LoyaltyPointsCard, { type LoyaltyCardData } from "./LoyaltyPointsCard";

/* ── Types ── */
type ChatMessage = { role: "user" | "assistant"; content: string; loyaltyCard?: LoyaltyCardData; orderConfirmation?: OrderConfirmation };

type OrderConfirmation = { order_id: string; customer_name: string; amount_cents: number };

/* ── Helpers ── */

/** Sanitize a URL string: only allows http/https, returns null for anything else. */
function sanitizeUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.href
      .replace(/javascript\s*:/gi, "")
      .replace(/data\s*:/gi, "")
      .replace(/vbscript\s*:/gi, "");
  } catch {
    return null;
  }
}

/** Convert URLs and markdown links in chat text to clickable <a> tags. */
function linkify(text: string): React.ReactNode[] {
  text = text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/^[-*]\s+/gm, "• ");

  const pattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(https?:\/\/[^\s),]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const label = match[1] || match[3];
    const rawHref = match[2] || match[3];
    const cleanUrl = sanitizeUrl(rawHref);
    parts.push(
      <a
        key={match.index}
        href={cleanUrl ?? "#"}
        target="_blank"
        rel="noopener noreferrer"
        className="underline font-medium hover:opacity-80"
      >
        {label}
      </a>,
    );
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

/* Web Speech types are declared globally in types/web-speech.d.ts:
   BrewSpeechRecognition, BrewSpeechRecognitionEvent, BrewSpeechRecognitionErrorEvent */

/* ── Component ── */
export default function EliseChat() {
  /* ─── Panel open/close ─── */
  const [isOpen, setIsOpen] = useState(false);

  /* ─── Chat state ─── */
  const [chatInput, setChatInput] = useState("");
  const [chatTyping, setChatTyping] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Hey! I'm Elise, your BrewHub helper. Ask me about our menu, your account, or anything else!",
    },
  ]);

  /* ─── Voice state ─── */
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [isVoiceProcessing, setIsVoiceProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  /* ─── Refs ─── */
  const chatSubmittingRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatBoxRef = useRef<HTMLDivElement>(null);
  const initialRenderRef = useRef(true);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const recognitionRef = useRef<BrewSpeechRecognition | null>(null);
  const audioRef = useRef<HTMLAudioElement | AudioBufferSourceNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const voiceCancelledRef = useRef(false);
  const isSpeakingRef = useRef(false);
  const isVoiceActiveRef = useRef(false);
  const voiceStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastedOrdersRef = useRef<Set<string>>(new Set());

  /* ─── Keep mutable refs in sync ─── */
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    isVoiceActiveRef.current = isVoiceActive;
  }, [isVoiceActive]);

  /* ── Order confirmation toast (fires once per unique order_id) ── */
  useEffect(() => {
    for (const msg of messages) {
      if (msg.orderConfirmation && !toastedOrdersRef.current.has(msg.orderConfirmation.order_id)) {
        const { order_id, customer_name, amount_cents } = msg.orderConfirmation;
        toastedOrdersRef.current.add(order_id);
        toast.success('Order Confirmed! \u2615', {
          description: `#${order_id.slice(-4).toUpperCase()} for ${customer_name} \u2014 $${(amount_cents / 100).toFixed(2)}`,
        });
      }
    }
  }, [messages]);

  /* Anti-echo: hard-abort the recogniser while TTS plays */
  useEffect(() => {
    if (isSpeaking && recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        /* ok if not started */
      }
    }
  }, [isSpeaking]);

  /* Auto-scroll chat (skip first render) */
  useEffect(() => {
    if (initialRenderRef.current) {
      initialRenderRef.current = false;
      return;
    }
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [messages, chatTyping]);

  /* Cleanup voice + timers on unmount */
  useEffect(() => {
    return () => {
      stopVoiceSession();
      if (voiceStatusTimerRef.current) clearTimeout(voiceStatusTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Shared helper: send text to Claude and return the reply ── */
  const sendToClaude = useCallback(async (userText: string): Promise<{ reply: string; loyaltyCard: LoyaltyCardData | null; orderConfirmation: OrderConfirmation | null }> => {
    const chatHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "X-BrewHub-Action": "true",
    };
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) {
      chatHeaders["Authorization"] = `Bearer ${session.access_token}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const response = await fetch("/.netlify/functions/claude-chat", {
        method: "POST",
        headers: chatHeaders,
        signal: controller.signal,
        body: JSON.stringify({
          text: userText,
          email: localStorage.getItem("brewhub_email") || "",
          history: messagesRef.current
            .slice(-10)
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await response.json();
      return { reply: data.reply || "Sorry, I didn't catch that.", loyaltyCard: data.loyaltyCard || null, orderConfirmation: data.orderConfirmation || null };
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        return { reply: "Sorry, that took too long! Give me a second and try again.", loyaltyCard: null, orderConfirmation: null };
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }, []);

  /* ── Play Elise's reply through ElevenLabs TTS ── */
  const speakReply = useCallback(async (text: string) => {
    if (voiceCancelledRef.current) return;
    try {
      const ttsText = text
        .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1 (link in the chat)")
        .replace(/https?:\/\/[^\s),]+/g, "link in the chat");

      const res = await fetch("/.netlify/functions/text-to-speech", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-BrewHub-Action": "true",
        },
        body: JSON.stringify({ text: ttsText }),
      });

      if (!res.ok) return;
      if (voiceCancelledRef.current) return;

      isSpeakingRef.current = true;
      setIsSpeaking(true);

      const audioBlob = await res.blob();
      const arrayBuffer = await audioBlob.arrayBuffer();

      // iOS/Safari: use Web Audio API
      const ctx = audioContextRef.current;
      if (ctx) {
        if (ctx.state === "suspended") await ctx.resume();

        try {
          const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
          const source = ctx.createBufferSource();
          source.buffer = decoded;
          source.connect(ctx.destination);

          source.onended = () => {
            audioRef.current = null;
            isSpeakingRef.current = false;
            setIsSpeaking(false);
            if (recognitionRef.current && isVoiceActiveRef.current) {
              setVoiceStatus("Listening...");
              try {
                recognitionRef.current.start();
              } catch {
                /* already started */
              }
            }
          };

          audioRef.current = source as unknown as HTMLAudioElement;
          setVoiceStatus("Elise is speaking...");
          source.start(0);
          return;
        } catch {
          /* decode failed — fall through to Audio() */
        }
      }

      // Fallback: standard Audio element
      const audioUrl = URL.createObjectURL(
        new Blob([arrayBuffer], { type: "audio/mpeg" }),
      );
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        audioRef.current = null;
        isSpeakingRef.current = false;
        setIsSpeaking(false);
        if (recognitionRef.current && isVoiceActiveRef.current) {
          setVoiceStatus("Listening...");
          try {
            recognitionRef.current.start();
          } catch {
            /* already started */
          }
        }
      };

      setVoiceStatus("Elise is speaking...");
      await audio.play();
    } catch {
      isSpeakingRef.current = false;
      setIsSpeaking(false);
      if (recognitionRef.current && isVoiceActiveRef.current) {
        setVoiceStatus("Listening...");
        try {
          recognitionRef.current.start();
        } catch {
          /* already started */
        }
      }
    }
  }, []);

  /* ── Handle a single voice turn ── */
  const handleVoiceTurn = useCallback(
    async (transcript: string) => {
      if (!transcript.trim()) return;
      if (voiceCancelledRef.current) return;

      setIsVoiceProcessing(true);
      setMessages((prev) => [...prev, { role: "user", content: transcript }]);
      setVoiceStatus("Thinking...");

      try {
        const { reply, loyaltyCard, orderConfirmation } = await sendToClaude(transcript);
        if (voiceCancelledRef.current) {
          setMessages((prev) => [...prev, { role: "assistant", content: reply, ...(loyaltyCard ? { loyaltyCard } : {}), ...(orderConfirmation ? { orderConfirmation } : {}) }]);
          return;
        }
        setMessages((prev) => [...prev, { role: "assistant", content: reply, ...(loyaltyCard ? { loyaltyCard } : {}), ...(orderConfirmation ? { orderConfirmation } : {}) }]);
        await speakReply(reply);
      } catch {
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              "I'm having trouble connecting to my coffee sensors. Try again in a second!",
          },
        ]);
        if (recognitionRef.current) {
          setVoiceStatus("Listening...");
          try {
            recognitionRef.current.start();
          } catch {
            /* already started */
          }
        }
      } finally {
        setIsVoiceProcessing(false);
      }
    },
    [sendToClaude, speakReply],
  );

  /* ── Start voice session ── */
  const startVoiceSession = async () => {
    const SpeechRecognitionCtor =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setVoiceStatus("Voice not supported in this browser. Try Chrome or Edge.");
      voiceStatusTimerRef.current = setTimeout(() => {
        setVoiceStatus("");
        voiceStatusTimerRef.current = null;
      }, 4000);
      return;
    }

    try {
      setVoiceStatus("Requesting mic access...");
      await navigator.mediaDevices.getUserMedia({ audio: true });

      if (!audioContextRef.current) {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        if (AudioCtx) audioContextRef.current = new AudioCtx();
      }
      if (audioContextRef.current?.state === "suspended") {
        await audioContextRef.current.resume();
      }

      const recognition = new SpeechRecognitionCtor() as BrewSpeechRecognition;
      recognition.lang = "en-US";
      recognition.interimResults = false;
      recognition.continuous = false;
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: BrewSpeechRecognitionEvent) => {
        const transcript = event.results[0][0].transcript;
        handleVoiceTurn(transcript);
      };

      recognition.onerror = (event: BrewSpeechRecognitionErrorEvent) => {
        if (event.error === "no-speech" || event.error === "aborted") {
          if (recognitionRef.current) {
            try {
              recognitionRef.current.start();
            } catch {
              /* ok */
            }
          }
          return;
        }
        setVoiceStatus(`Mic error: ${event.error}`);
        voiceStatusTimerRef.current = setTimeout(() => {
          setVoiceStatus("");
          voiceStatusTimerRef.current = null;
        }, 3000);
      };

      recognition.onend = () => {
        if (
          recognitionRef.current &&
          isVoiceActiveRef.current &&
          !isSpeakingRef.current
        ) {
          try {
            recognitionRef.current.start();
          } catch {
            /* ok */
          }
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
      setIsVoiceActive(true);
      setVoiceStatus("Listening... speak now!");
    } catch {
      setVoiceStatus("Failed to start — check mic permissions");
      setIsVoiceActive(false);
      voiceStatusTimerRef.current = setTimeout(() => {
        setVoiceStatus("");
        voiceStatusTimerRef.current = null;
      }, 3000);
    }
  };

  /* ── Stop voice session ── */
  const stopVoiceSession = () => {
    voiceCancelledRef.current = true;
    isVoiceActiveRef.current = false;
    isSpeakingRef.current = false;
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    if (audioRef.current) {
      const src = audioRef.current;
      if (src instanceof AudioBufferSourceNode) {
        try {
          src.stop();
        } catch {
          /* already stopped */
        }
      } else if (src instanceof HTMLAudioElement) {
        try {
          src.pause();
        } catch {
          /* ok */
        }
      }
      audioRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setIsSpeaking(false);
    setIsVoiceActive(false);
    setIsVoiceProcessing(false);
    setVoiceStatus("");
  };

  const toggleVoice = () => {
    if (isVoiceActive) {
      stopVoiceSession();
    } else {
      voiceCancelledRef.current = false;
      startVoiceSession();
    }
  };

  /* ── Text chat handler ── */
  const handleTextChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || chatSubmittingRef.current) return;
    chatSubmittingRef.current = true;

    const userText = chatInput;
    setMessages((prev) => [...prev, { role: "user", content: userText }]);
    setChatInput("");
    setChatTyping(true);

    try {
      const { reply, loyaltyCard, orderConfirmation } = await sendToClaude(userText);
      setMessages((prev) => [...prev, { role: "assistant", content: reply, ...(loyaltyCard ? { loyaltyCard } : {}), ...(orderConfirmation ? { orderConfirmation } : {}) }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "I'm having trouble connecting to my coffee sensors. Try again in a second!",
        },
      ]);
    } finally {
      setChatTyping(false);
      chatSubmittingRef.current = false;
    }
  };

  return (
    <>
      <Toaster position="bottom-left" richColors />
      {/* ── FAB toggle button ── */}
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        aria-label={isOpen ? "Close chat" : "Chat with Elise"}
        className={[
          "fixed bottom-5 right-5 z-[150] flex h-14 w-14 items-center justify-center",
          "rounded-full shadow-lg transition-all duration-200",
          "bg-[var(--hub-espresso)] text-[var(--hub-tan)] hover:scale-105",
          "sm:bottom-6 sm:right-6 sm:h-16 sm:w-16",
          // iOS safe area
          "pb-safe",
        ].join(" ")}
      >
        {isOpen ? (
          /* X icon */
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-7 w-7"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        ) : (
          /* Chat icon */
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-7 w-7"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
        )}
      </button>

      {/* ── Chat panel ── */}
      {isOpen && (
        <div
          className={[
            "fixed z-[140] flex flex-col",
            "bg-white/95 backdrop-blur-lg shadow-2xl",
            "border-2 border-[var(--hub-tan)] rounded-2xl overflow-hidden",
            // Mobile: nearly full-screen, above the FAB
            "inset-x-3 bottom-24 top-16",
            // Desktop: anchored bottom-right, sized panel
            "sm:inset-auto sm:bottom-24 sm:right-6 sm:w-[400px] sm:h-[540px]",
            // iOS safe area
            "pb-safe",
          ].join(" ")}
        >
          {/* Header */}
          <div className="flex items-center gap-3 border-b border-[var(--hub-tan)] bg-[var(--hub-espresso)] px-5 py-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--hub-tan)] text-sm font-bold text-[var(--hub-espresso)]">
              E
            </div>
            <div>
              <p className="text-sm font-bold text-[var(--hub-tan)]">Elise</p>
              <p className="text-[0.68rem] uppercase tracking-widest text-stone-400">
                BrewHub Concierge
              </p>
            </div>
          </div>

          {/* Messages */}
          <div
            ref={chatBoxRef}
            className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 flex flex-col gap-2"
          >
            {messages.map((m, i) => (
              <div
                key={i}
                className={
                  m.role === "user"
                    ? "chat-bubble chat-bubble-user"
                    : "chat-bubble chat-bubble-bot"
                }
              >
                <span className="chat-bubble-label">
                  {m.role === "user" ? "You" : "Elise"}
                </span>
                {linkify(m.content)}
                {m.loyaltyCard && <LoyaltyPointsCard data={m.loyaltyCard} />}
              </div>
            ))}
            {chatTyping && (
              <div
                className="chat-bubble chat-bubble-bot"
                aria-live="polite"
                aria-label="Elise is typing"
              >
                <span className="chat-bubble-label">Elise</span>
                <span
                  style={{
                    letterSpacing: "0.15em",
                    fontSize: "1.3rem",
                    lineHeight: 1,
                  }}
                >
                  ···
                </span>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input row */}
          <div className="border-t border-stone-200 bg-white px-3 py-2">
            <form onSubmit={handleTextChat} className="flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Ask Elise anything..."
                className="concierge-input flex-1"
              />
              <button
                type="submit"
                className="concierge-send-btn"
                disabled={chatTyping || !chatInput.trim()}
              >
                Send
              </button>
            </form>

            {/* Voice */}
            <button
              className={
                isVoiceActive ? "voice-btn voice-btn-active" : "voice-btn"
              }
              onClick={toggleVoice}
              disabled={isVoiceProcessing}
            >
              {isVoiceActive ? "🛑 Stop Voice Chat" : "🎤 Start Voice Chat"}
            </button>
            {voiceStatus && (
              <div className="voice-status">{voiceStatus}</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
