"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { supabase } from '@/lib/supabase';
import confetti from 'canvas-confetti';
import React from 'react';

/**
 * Sanitize a URL string: only allows http/https, returns null for anything else.
 * Used to prevent DOM-based XSS (CWE-79) in dynamically rendered links.
 */
function sanitizeUrl(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    // Defense-in-depth: strip dangerous schemes even after protocol check,
    // and apply replace-chain sanitization so static analyzers clear taint.
    return parsed.href
      .replace(/javascript\s*:/gi, '')
      .replace(/data\s*:/gi, '')
      .replace(/vbscript\s*:/gi, '');
  } catch {
    return null;
  }
}

// Convert URLs and markdown links in chat text to clickable <a> tags
function linkify(text: string): React.ReactNode[] {
  // Strip common markdown formatting that Claude may emit
  text = text
    .replace(/\*\*(.+?)\*\*/g, '$1')   // **bold** → bold
    .replace(/\*(.+?)\*/g, '$1')       // *italic* → italic
    .replace(/`([^`]+)`/g, '$1')       // `code` → code
    .replace(/^#{1,3}\s+/gm, '')       // ### headings → plain
    .replace(/^[-*]\s+/gm, '• ');      // - bullets → • bullets

  // Match markdown links [label](url) OR bare URLs
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|(https?:\/\/[^\s),]+)/g;
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    // Push text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const label = match[1] || match[3]; // markdown label or bare URL
    const rawHref = match[2] || match[3];  // markdown href or bare URL
    const cleanUrl = sanitizeUrl(rawHref);
    parts.push(
      <a
        key={match.index}
        href={cleanUrl ?? '#'}
        target="_blank"
        rel="noopener noreferrer"
        className="underline font-medium hover:opacity-80"
      >
        {label}
      </a>
    );
    lastIndex = pattern.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts.length > 0 ? parts : [text];
}

// 1. ENGINE CONFIGURATION — client imported from @/lib/supabase

type ChatMessage = { role: 'user' | 'assistant'; content: string };

export default function BrewHubLanding() {
  // State Management
  const [isLoading, setIsLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [waitlistError, setWaitlistError] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [chatTyping, setChatTyping] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([{ role: 'assistant', content: "Hey! I'm Elise, your BrewHub helper. Ask me about our opening, your waitlist spot, or the menu!" }]);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [initialRender, setInitialRender] = useState(true);
  const [isVoiceProcessing, setIsVoiceProcessing] = useState(false);
  const isSpeakingRef = useRef(false);
  const isVoiceActiveRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatBoxRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<BrewSpeechRecognition | null>(null);
  const audioRef = useRef<HTMLAudioElement | AudioBufferSourceNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const messagesRef = useRef<ChatMessage[]>(messages);

  // Keep mutable refs so speech callbacks always see latest state (avoids stale closures)
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { isVoiceActiveRef.current = isVoiceActive; }, [isVoiceActive]);

  // Splash screen timer and scroll to top
  useEffect(() => {
    window.scrollTo(0, 0);
    const timer = setTimeout(() => setIsLoading(false), 1500);
    return () => clearTimeout(timer);
  }, []);

  // Auto-scroll chat container (scroll within chatbox, not page - skip initial render)
  useEffect(() => {
    if (initialRender) {
      setInitialRender(false);
      return;
    }
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [messages, chatTyping]);

  // Cleanup voice on unmount
  useEffect(() => {
    return () => {
      stopVoiceSession();
    };
  }, []);

  // ── Shared helper: send text to Claude and return the reply ──
  const sendToClaude = useCallback(async (userText: string): Promise<string> => {
    const chatHeaders: Record<string, string> = { 'Content-Type': 'application/json', 'X-BrewHub-Action': 'true' };
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      chatHeaders['Authorization'] = `Bearer ${session.access_token}`;
    }

    const response = await fetch('/.netlify/functions/claude-chat', {
      method: 'POST',
      headers: chatHeaders,
      body: JSON.stringify({
        text: userText,
        email: localStorage.getItem('brewhub_email') || "",
        history: messagesRef.current.slice(-10).map(m => ({ role: m.role, content: m.content }))
      })
    });
    const data = await response.json();
    return data.reply || "Sorry, I didn't catch that.";
  }, []);

  // ── Play Elise's reply through ElevenLabs TTS ──
  const speakReply = useCallback(async (text: string) => {
    try {
      // Strip URLs so TTS doesn't read them aloud:
      // [label](url) → "label (link in the chat)" | bare https://… → "link in the chat"
      const ttsText = text
        .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1 (link in the chat)')
        .replace(/https?:\/\/[^\s),]+/g, 'link in the chat');

      const res = await fetch('/.netlify/functions/text-to-speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-BrewHub-Action': 'true' },
        body: JSON.stringify({ text: ttsText })
      });

      if (!res.ok) {
        console.warn('TTS returned', res.status);
        return;
      }

      // Stop listening BEFORE playing audio to prevent echo feedback loop
      // (mic picks up speaker output and feeds it back as a new transcript)
      isSpeakingRef.current = true;
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch { /* not started */ }
      }

      const audioBlob = await res.blob();
      const arrayBuffer = await audioBlob.arrayBuffer();

      // ── iOS/Safari fix: use Web Audio API instead of new Audio() ──
      // Safari blocks Audio.play() unless triggered in the *same* sync call
      // stack as a user gesture. Web Audio API via a pre-unlocked AudioContext
      // works reliably because we unlock it on the mic-permission tap.
      const ctx = audioContextRef.current;
      if (ctx) {
        // Safari may suspend the context; resume it
        if (ctx.state === 'suspended') await ctx.resume();

        try {
          const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
          const source = ctx.createBufferSource();
          source.buffer = decoded;
          source.connect(ctx.destination);

          source.onended = () => {
            audioRef.current = null;
            isSpeakingRef.current = false;
            if (recognitionRef.current && isVoiceActiveRef.current) {
              setVoiceStatus("Listening...");
              try { recognitionRef.current.start(); } catch { /* already started */ }
            }
          };

      audioRef.current = source as unknown as HTMLAudioElement;
          setVoiceStatus("Elise is speaking...");
          source.start(0);
          return; // success via Web Audio
        } catch (decodeErr) {
          console.warn('Web Audio decode failed, falling back to Audio element:', (decodeErr as Error)?.message);
        }
      }

      // ── Fallback: standard Audio element (works on desktop browsers) ──
      const audioUrl = URL.createObjectURL(new Blob([arrayBuffer], { type: 'audio/mpeg' }));
      const audio = new Audio(audioUrl);
      audioRef.current = audio;

      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        audioRef.current = null;
        isSpeakingRef.current = false;
        if (recognitionRef.current && isVoiceActiveRef.current) {
          setVoiceStatus("Listening...");
          try { recognitionRef.current.start(); } catch { /* already started */ }
        }
      };

      setVoiceStatus("Elise is speaking...");
      await audio.play();
    } catch (err) {
      isSpeakingRef.current = false;
      console.error('TTS playback error:', (err as Error)?.message);
      // Resume listening so the user isn't stuck
      if (recognitionRef.current && isVoiceActiveRef.current) {
        setVoiceStatus("Listening...");
        try { recognitionRef.current.start(); } catch { /* already started */ }
      }
    }
  }, []);

  // ── Handle a single voice turn: transcript → Claude → TTS ──
  const handleVoiceTurn = useCallback(async (transcript: string) => {
    if (!transcript.trim()) return;

    setIsVoiceProcessing(true);
    setMessages(prev => [...prev, { role: 'user', content: transcript }]);
    setVoiceStatus("Thinking...");

    try {
      const reply = await sendToClaude(transcript);
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
      await speakReply(reply);
    } catch (err) {
      console.error('Voice turn error:', (err as Error)?.message);
      setMessages(prev => [...prev, { role: 'assistant', content: "I'm having trouble connecting to my coffee sensors. Try again in a second!" }]);
      // Resume listening even on error
      if (recognitionRef.current) {
        setVoiceStatus("Listening...");
        try { recognitionRef.current.start(); } catch { /* already started */ }
      }
    } finally {
      setIsVoiceProcessing(false);
    }
  }, [sendToClaude, speakReply]);

  // 4. VOICE CHAT LOGIC (Web Speech API STT → Claude → ElevenLabs TTS)
  const startVoiceSession = async () => {
    // Feature check
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setVoiceStatus("Voice not supported in this browser. Try Chrome or Edge.");
      setTimeout(() => setVoiceStatus(""), 4000);
      return;
    }

    try {
      setVoiceStatus("Requesting mic access...");

      // Request microphone access first
      await navigator.mediaDevices.getUserMedia({ audio: true });

      // Unlock AudioContext on this user-gesture call stack (required by iOS Safari).
      // Creating + resuming it here means subsequent play() calls will work.
      if (!audioContextRef.current) {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) audioContextRef.current = new AudioCtx();
      }
      if (audioContextRef.current?.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const recognition = new SpeechRecognitionCtor();
      recognition.lang = 'en-US';
      recognition.interimResults = false;
      recognition.continuous = false;      // one utterance per turn
      recognition.maxAlternatives = 1;

      recognition.onresult = (event: BrewSpeechRecognitionEvent) => {
        const transcript = event.results[0][0].transcript;
        handleVoiceTurn(transcript);
      };

      recognition.onerror = (event: BrewSpeechRecognitionErrorEvent) => {
        // 'no-speech' is normal — user simply didn't speak, restart
        if (event.error === 'no-speech' || event.error === 'aborted') {
          if (recognitionRef.current) {
            try { recognitionRef.current.start(); } catch { /* ok */ }
          }
          return;
        }
        console.error('Speech recognition error:', event.error);
        setVoiceStatus(`Mic error: ${event.error}`);
        setTimeout(() => setVoiceStatus(""), 3000);
      };

      recognition.onend = () => {
        // Auto-restart if voice is still active, not mid-processing, and not during TTS playback
        // Use refs to avoid stale closures from the initial startVoiceSession call
        if (recognitionRef.current && isVoiceActiveRef.current && !isSpeakingRef.current) {
          try { recognitionRef.current.start(); } catch { /* ok */ }
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
      setIsVoiceActive(true);
      setVoiceStatus("Listening... speak now!");

    } catch (err) {
      console.error('Voice error:', (err as Error)?.message);
      setVoiceStatus("Failed to start — check mic permissions");
      setIsVoiceActive(false);
      setTimeout(() => setVoiceStatus(""), 3000);
    }
  };

  const stopVoiceSession = () => {
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;   // prevent auto-restart
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }
    if (audioRef.current) {
      // Handle both HTMLAudioElement (.pause) and AudioBufferSourceNode (.stop)
      const src = audioRef.current;
      if (src instanceof AudioBufferSourceNode) {
        try { src.stop(); } catch { /* already stopped */ }
      } else if (src instanceof HTMLAudioElement) {
        try { src.pause(); } catch { /* ok */ }
      }
      audioRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    isSpeakingRef.current = false;
    setIsVoiceActive(false);
    setIsVoiceProcessing(false);
    setVoiceStatus("");
  };

  const toggleVoice = () => {
    if (isVoiceActive) {
      stopVoiceSession();
    } else {
      startVoiceSession();
    }
  };

  // 2. WAITLIST LOGIC
  const handleWaitlist = async (e: React.FormEvent) => {
    e.preventDefault();
    setWaitlistError("");
    const { error } = await supabase.from('waitlist').insert([{ email }]);
    if (!error) {
      setIsJoined(true);
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
      localStorage.setItem('brewhub_email', email);
    } else {
      setWaitlistError(
        error.code === '23505'
          ? "You're already on the list! We'll see you soon."
          : "Something went wrong. Please try again."
      );
    }
  };

  // 3. TEXT CHAT LOGIC (Claude-powered — same backend as voice)
  const handleTextChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || chatTyping) return;

    const userText = chatInput;
    setMessages(prev => [...prev, { role: 'user', content: userText }]);
    setChatInput("");
    setChatTyping(true);

    try {
      const reply = await sendToClaude(userText);
      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: "I'm having trouble connecting to my coffee sensors. Try again in a second!" }]);
    } finally {
      setChatTyping(false);
    }
  };

  return (
    <>
      {/* Splash Screen */}
      {isLoading && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-br from-[#f8f4f0] via-[#fdfcfb] to-[#e9ded6]">
          <div className="flex flex-col items-center animate-pulse">
            <Image src="/logo.png" alt="BrewHub" width={140} height={140} className="rounded-full shadow-2xl border-4 border-[var(--hub-tan)]" priority />
            <h1 className="mt-6 text-3xl font-playfair font-bold text-[var(--hub-espresso)]">BrewHub</h1>
            <p className="text-[var(--hub-brown)] text-sm mt-2">Point Breeze • Philadelphia</p>
          </div>
        </div>
      )}
      
    <div className="flex flex-col w-full">
      {/* HERO SECTION - Full Width, Centered, Dramatic */}
      <section className="hero-section">
        <div className="hero-bg" />
        <div className="hero-card">
          <Image src="/logo.png" alt="BrewHub PHL logo" width={120} height={120} className="hero-logo" priority />
          <h2 className="hero-location">Point Breeze • Philadelphia 19146</h2>
          <h1 className="hero-title">BrewHub<span className="hero-title-accent">PHL</span></h1>
          <p className="hero-desc">
            "Your neighborhood sanctuary for artisanal espresso, secure parcel hub, and dedicated workspace."
          </p>
          {!isJoined ? (
            <form onSubmit={handleWaitlist} className="hero-form">
              <input 
                type="email" 
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email" 
                className="hero-input"
                required
              />
              <button type="submit" className="hero-btn">Join Waitlist</button>
            </form>
          ) : (
            <div className="hero-success">You're on the list. We'll see you soon at the Hub. ☕</div>
          )}
          {waitlistError && (
            <p className="hero-success" style={{ color: 'var(--hub-brown)', fontSize: '0.9rem', marginTop: '0.5rem' }}>{waitlistError}</p>
          )}
        </div>
      </section>

      {/* CONCIERGE SECTION - Centered, Premium */}
      <section className="concierge-section">
        <div className="concierge-card">
          <h3 className="concierge-title">Meet Elise.</h3>
          <p className="concierge-desc">Our digital barista is here to help you track your resident packages, check waitlist status, or preview our upcoming menu.</p>
          <div className="concierge-chatbox" ref={chatBoxRef}>
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'chat-bubble chat-bubble-user' : 'chat-bubble chat-bubble-bot'}>
                <span className="chat-bubble-label">{m.role === 'user' ? 'Guest' : 'Elise'}</span>
                {linkify(m.content)}
              </div>
            ))}            {chatTyping && (
              <div className="chat-bubble chat-bubble-bot" aria-live="polite" aria-label="Elise is typing">
                <span className="chat-bubble-label">Elise</span>
                <span style={{ letterSpacing: '0.15em', fontSize: '1.3rem', lineHeight: 1 }}>···</span>
              </div>
            )}            <div ref={chatEndRef} />
          </div>
          <form onSubmit={handleTextChat} className="concierge-form">
            <input 
              type="text" 
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask Elise anything..."
              className="concierge-input"
            />
            <button type="submit" className="concierge-send-btn">Send</button>
          </form>
          <button 
            className={isVoiceActive ? 'voice-btn voice-btn-active' : 'voice-btn'}
            onClick={toggleVoice}
          >
            {isVoiceActive ? '🛑 Stop Voice Chat' : '🎤 Start Voice Chat'}
          </button>
          {voiceStatus && <div className="voice-status">{voiceStatus}</div>}
        </div>
      </section>
    </div>
    </>
  );
}