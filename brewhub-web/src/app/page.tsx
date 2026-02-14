"use client";

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { createClient } from '@supabase/supabase-js';
import confetti from 'canvas-confetti';

// 1. ENGINE CONFIGURATION
const SUPABASE_URL = 'https://rruionkpgswvncypweiv.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJydWlvbmtwZ3N3dm5jeXB3ZWl2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkzMTQ5MDYsImV4cCI6MjA4NDg5MDkwNn0.fzM310q9Qs_f-zhuBqyjnQXs3mDmOp_dbiFRs0ctQmU';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export default function BrewHubLanding() {
  // State Management
  const [email, setEmail] = useState("");
  const [isJoined, setIsJoined] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [messages, setMessages] = useState([{ role: 'assistant', content: "Welcome! I'm Elise, the BrewHub concierge. Feel free to ask about our opening or your waitlist status!" }]);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  // Auto-scroll chat (only scroll within chatbox, not the whole page)
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [messages]);

  // Cleanup voice on unmount
  useEffect(() => {
    return () => {
      stopVoiceSession();
    };
  }, []);

  // 4. VOICE CHAT LOGIC (ElevenLabs)
  const startVoiceSession = async () => {
    try {
      setVoiceStatus("Connecting...");
      
      // Get signed URL from Netlify function
      const res = await fetch('/.netlify/functions/get-voice-session');
      const data = await res.json();
      
      if (!data.signedUrl) {
        throw new Error(data.error || 'Failed to get voice session');
      }

      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // Create audio context
      audioContextRef.current = new AudioContext({ sampleRate: 16000 });
      
      // Connect WebSocket to ElevenLabs
      const ws = new WebSocket(data.signedUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setIsVoiceActive(true);
        setVoiceStatus("Listening...");
        
        // Start sending audio
        const audioContext = audioContextRef.current!;
        const source = audioContext.createMediaStreamSource(stream);
        const processor = audioContext.createScriptProcessor(4096, 1, 1);
        
        processor.onaudioprocess = (e) => {
          if (ws.readyState === WebSocket.OPEN) {
            const inputData = e.inputBuffer.getChannelData(0);
            const pcm16 = new Int16Array(inputData.length);
            for (let i = 0; i < inputData.length; i++) {
              pcm16[i] = Math.max(-32768, Math.min(32767, inputData[i] * 32768));
            }
            ws.send(JSON.stringify({
              type: 'audio',
              audio: btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)))
            }));
          }
        };
        
        source.connect(processor);
        processor.connect(audioContext.destination);
      };

      ws.onmessage = async (event) => {
        const msg = JSON.parse(event.data);
        
        if (msg.type === 'audio' && msg.audio) {
          // Play received audio
          const audioData = Uint8Array.from(atob(msg.audio), c => c.charCodeAt(0));
          const audioContext = new AudioContext();
          const audioBuffer = await audioContext.decodeAudioData(audioData.buffer);
          const source = audioContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(audioContext.destination);
          source.start();
        } else if (msg.type === 'transcript') {
          if (msg.role === 'user') {
            setMessages(prev => [...prev, { role: 'user', content: msg.text }]);
          } else if (msg.role === 'assistant') {
            setMessages(prev => [...prev, { role: 'assistant', content: msg.text }]);
          }
        }
      };

      ws.onerror = () => {
        setVoiceStatus("Connection error");
        stopVoiceSession();
      };

      ws.onclose = () => {
        setIsVoiceActive(false);
        setVoiceStatus("");
      };

    } catch (err) {
      console.error('Voice error:', err);
      setVoiceStatus("Failed to start voice");
      setIsVoiceActive(false);
      setTimeout(() => setVoiceStatus(""), 3000);
    }
  };

  const stopVoiceSession = () => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
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
      const response = await fetch('/.netlify/functions/claude-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          text: userText,
          email: localStorage.getItem('brewhub_email') || "" 
        })
      });
      const data = await response.json();
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: "I'm having trouble connecting to my coffee sensors. Try again in a second!" }]);
    }
  };

  return (
    <div className="flex flex-col min-h-screen w-full">
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
          <div className="concierge-chatbox">
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'chat-bubble chat-bubble-user' : 'chat-bubble chat-bubble-bot'}>
                <span className="chat-bubble-label">{m.role === 'user' ? 'Guest' : 'Elise'}</span>
                {m.content}
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
            {isVoiceActive ? '🛑 Stop Voice Session' : '🎤 Start Voice Concierge'}
          </button>
          {voiceStatus && <div className="voice-status">{voiceStatus}</div>}
        </div>
      </section>
    </div>
  );
}