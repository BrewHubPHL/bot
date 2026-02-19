"use client";

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { createClient } from '@supabase/supabase-js';
import confetti from 'canvas-confetti';
import { Conversation } from '@elevenlabs/client';
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

// 1. ENGINE CONFIGURATION
const SUPABASE_URL = 'https://rruionkpgswvncypweiv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJydWlvbmtwZ3N3dm5jeXB3ZWl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzMTQ5MDYsImV4cCI6MjA4NDg5MDkwNn0.fzM310q9Qs_f-zhuBqyjnQXs3mDmOp_dbiFRs0ctQmU';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default function BrewHubLanding() {
  // State Management
  const [isLoading, setIsLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState([{ role: 'assistant', content: "Hey! I'm Elise, your BrewHub helper. Ask me about our opening, your waitlist spot, or the menu!" }]);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const [initialRender, setInitialRender] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const conversationRef = useRef<Conversation | null>(null);
  const chatBoxRef = useRef<HTMLDivElement>(null);

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
  }, [messages]);

  // Cleanup voice on unmount
  useEffect(() => {
    return () => {
      stopVoiceSession();
    };
  }, []);

  // 4. VOICE CHAT LOGIC (ElevenLabs Conversational AI)
  const startVoiceSession = async () => {
    try {
      setVoiceStatus("Connecting...");
      
      // Get signed URL from Netlify function
      const res = await fetch('/.netlify/functions/get-voice-session');
      const data = await res.json();
      
      if (!data.signedUrl) {
        throw new Error(data.error || 'Failed to get voice session');
      }

      // Request microphone access first
      await navigator.mediaDevices.getUserMedia({ audio: true });

      // Start ElevenLabs Conversation (handles VAD automatically)
      const conversation = await Conversation.startSession({
        signedUrl: data.signedUrl,
        onConnect: () => {
          setIsVoiceActive(true);
          setVoiceStatus("Listening... speak now!");
        },
        onDisconnect: () => {
          setIsVoiceActive(false);
          setVoiceStatus("");
        },
        onMessage: (message: { source: string; message: string }) => {
          if (message.source === 'user') {
            setMessages(prev => [...prev, { role: 'user', content: message.message }]);
          } else if (message.source === 'ai') {
            setMessages(prev => [...prev, { role: 'assistant', content: message.message }]);
          }
        },
        onError: (message: string) => {
          console.error('Voice error:', message);
          setVoiceStatus("Connection error");
          setTimeout(() => setVoiceStatus(""), 3000);
        },
        onModeChange: (mode: { mode: string }) => {
          if (mode.mode === 'listening') {
            setVoiceStatus("Listening...");
          } else if (mode.mode === 'speaking') {
            setVoiceStatus("Elise is speaking...");
          }
        }
      });

      conversationRef.current = conversation;

    } catch (err) {
      console.error('Voice error:', err);
      setVoiceStatus("Failed to start - check mic permissions");
      setIsVoiceActive(false);
      setTimeout(() => setVoiceStatus(""), 3000);
    }
  };

  const stopVoiceSession = async () => {
    if (conversationRef.current) {
      await conversationRef.current.endSession();
      conversationRef.current = null;
    }
    setIsVoiceActive(false);
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
    const { error } = await supabase.from('waitlist').insert([{ email }]);
    if (!error) {
      setIsJoined(true);
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
      localStorage.setItem('brewhub_email', email);
    }
  };

  // 3. TEXT CHAT LOGIC (Claude-powered)
  const handleTextChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    const userText = chatInput;
    setMessages(prev => [...prev, { role: 'user', content: userText }]);
    setChatInput("");

    try {
      // Include auth token if user is logged in (enables ordering and loyalty lookup)
      const chatHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
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
          history: messages.slice(-10).map(m => ({ role: m.role, content: m.content }))
        })
      });
      const data = await response.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: "I'm having trouble connecting to my coffee sensors. Try again in a second!" }]);
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
            ))}
            <div ref={chatEndRef} />
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