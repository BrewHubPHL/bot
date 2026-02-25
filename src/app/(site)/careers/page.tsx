"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { Briefcase, Send, CheckCircle, ShieldCheck, Paperclip, FileText, Loader2 } from "lucide-react";

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB

const AVAILABILITY_OPTIONS = [
  "Weekday mornings (6am–12pm)",
  "Weekday afternoons (12pm–5pm)",
  "Weekday evenings (5pm–close)",
  "Weekend mornings (6am–12pm)",
  "Weekend afternoons (12pm–5pm)",
  "Weekend evenings (5pm–close)",
  "Open availability",
];

interface FormState {
  name: string;
  email: string;
  phone: string;
  availability: string;
  scenario_answer: string;
  vibe_check: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  email: "",
  phone: "",
  availability: "",
  scenario_answer: "",
  vibe_check: "",
};

export default function CareersPage() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [honeypot, setHoneypot] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const loadTimeRef = useRef(Date.now());
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Capture mount timestamp for timing-based bot defense */
  useEffect(() => {
    loadTimeRef.current = Date.now();
  }, []);

  function handleChange(
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >
  ) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (file && file.size > MAX_FILE_SIZE) {
      setError("File is too large. Please upload a PDF under 5 MB.");
      e.target.value = "";
      setResumeFile(null);
      return;
    }
    if (file && file.type !== "application/pdf") {
      setError("Only PDF files are accepted.");
      e.target.value = "";
      setResumeFile(null);
      return;
    }
    setError("");
    setResumeFile(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!form.name.trim()) return setError("Please enter your full name.");
    if (!form.email.trim()) return setError("Please enter your email address.");
    if (!form.availability)
      return setError("Please select your general availability.");
    if (!form.scenario_answer.trim())
      return setError("Please answer the experience question.");
    if (!form.vibe_check.trim())
      return setError("Please answer the quick check question.");

    setLoading(true);

    try {
      /* ── Upload resume PDF to Supabase Storage ──────── */
      let resume_url: string | null = null;

      if (resumeFile) {
        /* ── FIX 1: strict client-side size guard before any network call ── */
        if (resumeFile.size > MAX_FILE_SIZE) {
          setLoading(false);
          alert("File is too large. Please upload a PDF under 5 MB.");
          return;
        }

        setUploading(true);
        try {
          const slug = form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
          const filePath = `${Date.now()}-${slug}.pdf`;

          const { error: uploadErr } = await supabase.storage
            .from("resumes")
            .upload(filePath, resumeFile, {
              contentType: "application/pdf",
              upsert: false,
            });

          if (uploadErr) throw new Error(`Resume upload failed: ${uploadErr.message}`);

          const { data: urlData } = supabase.storage
            .from("resumes")
            .getPublicUrl(filePath);

          resume_url = urlData.publicUrl;
        } catch (uploadErr) {
          throw uploadErr;
        } finally {
          setUploading(false);
        }
      }

      /* ── Submit application (with 15 s timeout) ───── */
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      let res: Response;
      try {
        res = await fetch("/.netlify/functions/submit-application", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-BrewHub-Action": "true" },
          body: JSON.stringify({
            name: form.name.trim(),
            email: form.email.trim(),
            phone: form.phone.trim() || null,
            availability: form.availability,
            scenario_answer: form.scenario_answer.trim(),
            vibe_check: form.vibe_check.trim(),
            resume_url,
            user_zip_verification: honeypot,
            loadTime: loadTimeRef.current,
          }),
          signal: controller.signal,
        });
      } catch (fetchErr: unknown) {
        if (fetchErr instanceof DOMException && fetchErr.name === "AbortError") {
          throw new Error("Request timed out. Please check your connection and try again.");
        }
        throw new Error("Network disconnected. Please check your connection and try again.");
      } finally {
        clearTimeout(timeout);
      }

      const data = await res.json();
      if (!res.ok) throw new Error(
        /^(network|fetch|timeout|connection|invalid|required|rate limit)/i.test(data.error || "")
          ? data.error
          : "Submission failed"
      );

      setSuccess(true);
      setForm(EMPTY_FORM);
      setResumeFile(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-stone-950 py-16 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-[0.15em] mb-5">
            <Briefcase size={14} />
            Now Hiring
          </div>
          <h1 className="font-playfair text-4xl md:text-5xl font-bold text-white mb-4">
            Join Our Team
          </h1>
          <p className="text-stone-400 text-lg max-w-lg mx-auto leading-relaxed">
            We&apos;re building South Philly&apos;s neighborhood hub — craft
            coffee, parcel lockers, and community all in one. We hire for
            character first.
          </p>
        </div>

        {/* Card */}
        <div className="bg-stone-900 rounded-xl shadow-2xl border border-stone-800 p-8 md:p-10">
          {success ? (
            <div className="flex flex-col items-center text-center py-10 gap-4">
              <div className="w-16 h-16 rounded-full bg-green-500/10 border border-green-500/20 flex items-center justify-center">
                <CheckCircle size={32} className="text-green-400" />
              </div>
              <h2 className="font-playfair text-2xl font-bold text-white">
                Application received.
              </h2>
              <p className="text-stone-400 text-base">
                We&apos;ll be in touch — keep an eye on your inbox.
              </p>
              <Link
                href="/"
                className="mt-4 inline-block text-sm font-semibold tracking-wide text-amber-400 hover:text-amber-300 underline underline-offset-4 transition-colors"
              >
                ← Back to BrewHub
              </Link>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-5 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} noValidate className="space-y-5">
                {/* ── Honeypot (invisible to humans) ────────────── */}
                <div
                  aria-hidden="true"
                  style={{ position: "absolute", left: "-5000px" }}
                >
                  <label htmlFor="user_zip_verification">Leave empty</label>
                  <input
                    id="user_zip_verification"
                    name="user_zip_verification"
                    type="text"
                    tabIndex={-1}
                    autoComplete="off"
                    value={honeypot}
                    onChange={(e) => setHoneypot(e.target.value)}
                  />
                </div>

                {/* Name */}
                <div>
                  <label
                    htmlFor="name"
                    className="block text-xs font-semibold tracking-widest uppercase text-stone-500 mb-1.5"
                  >
                    Full Name <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="name"
                    name="name"
                    type="text"
                    autoComplete="name"
                    required
                    value={form.name}
                    onChange={handleChange}
                    placeholder="Jane Doe"
                    className="w-full px-4 py-3 rounded-lg border border-stone-700 bg-stone-800 text-white placeholder-stone-600 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/50 transition"
                  />
                </div>

                {/* Email */}
                <div>
                  <label
                    htmlFor="email"
                    className="block text-xs font-semibold tracking-widest uppercase text-stone-500 mb-1.5"
                  >
                    Email Address <span className="text-red-400">*</span>
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={form.email}
                    onChange={handleChange}
                    placeholder="jane@example.com"
                    className="w-full px-4 py-3 rounded-lg border border-stone-700 bg-stone-800 text-white placeholder-stone-600 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/50 transition"
                  />
                </div>

                {/* Phone */}
                <div>
                  <label
                    htmlFor="phone"
                    className="block text-xs font-semibold tracking-widest uppercase text-stone-500 mb-1.5"
                  >
                    Phone Number{" "}
                    <span className="text-stone-600 font-normal normal-case tracking-normal">
                      (optional)
                    </span>
                  </label>
                  <input
                    id="phone"
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    value={form.phone}
                    onChange={handleChange}
                    placeholder="(215) 555-0100"
                    className="w-full px-4 py-3 rounded-lg border border-stone-700 bg-stone-800 text-white placeholder-stone-600 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/50 transition"
                  />
                </div>

                {/* Availability */}
                <div>
                  <label
                    htmlFor="availability"
                    className="block text-xs font-semibold tracking-widest uppercase text-stone-500 mb-1.5"
                  >
                    General Availability <span className="text-red-400">*</span>
                  </label>
                  <select
                    id="availability"
                    name="availability"
                    required
                    value={form.availability}
                    onChange={handleChange}
                    className="w-full px-4 py-3 rounded-lg border border-stone-700 bg-stone-800 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/50 transition appearance-none"
                  >
                    <option value="" disabled>
                      Select your best availability…
                    </option>
                    {AVAILABILITY_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Scenario / Experience */}
                <div>
                  <label
                    htmlFor="scenario_answer"
                    className="block text-xs font-semibold tracking-widest uppercase text-stone-500 mb-1.5"
                  >
                    Resume / Experience <span className="text-red-400">*</span>
                  </label>
                  <p className="text-sm text-stone-400 mb-2 leading-relaxed">
                    Tell us about a time you had to deal with a frustrated
                    customer or neighbor, and how you handled it.
                  </p>
                  <textarea
                    id="scenario_answer"
                    name="scenario_answer"
                    required
                    rows={5}
                    value={form.scenario_answer}
                    onChange={handleChange}
                    placeholder="Share your experience here…"
                    className="w-full px-4 py-3 rounded-lg border border-stone-700 bg-stone-800 text-white placeholder-stone-600 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/50 transition resize-y min-h-[120px]"
                  />
                </div>

                {/* Resume Upload */}
                <div>
                  <label
                    htmlFor="resume"
                    className="block text-xs font-semibold tracking-widest uppercase text-stone-500 mb-1.5"
                  >
                    Resume (PDF){" "}
                    <span className="text-stone-600 font-normal normal-case tracking-normal">
                      (optional, 5 MB max)
                    </span>
                  </label>
                  <div
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-3 w-full px-4 py-3 rounded-lg border border-dashed border-stone-700 bg-stone-800/50 text-sm cursor-pointer hover:border-amber-500/40 transition group"
                  >
                    {resumeFile ? (
                      <>
                        <FileText size={18} className="text-amber-400 flex-shrink-0" />
                        <span className="text-white truncate">{resumeFile.name}</span>
                        <span className="text-stone-500 text-xs ml-auto flex-shrink-0">
                          {(resumeFile.size / 1024 / 1024).toFixed(1)} MB
                        </span>
                      </>
                    ) : (
                      <>
                        <Paperclip size={18} className="text-stone-600 group-hover:text-amber-500 transition flex-shrink-0" />
                        <span className="text-stone-500 group-hover:text-stone-300 transition">
                          Click to attach your resume…
                        </span>
                      </>
                    )}
                  </div>
                  <input
                    ref={fileInputRef}
                    id="resume"
                    name="resume"
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                </div>

                {/* Vibe Check — bot defense #3 */}
                <div className="bg-stone-800/50 border border-stone-700 rounded-lg p-4">
                  <label
                    htmlFor="vibe_check"
                    className="flex items-center gap-2 text-xs font-semibold tracking-widest uppercase text-stone-500 mb-1.5"
                  >
                    <ShieldCheck size={14} className="text-amber-500" />
                    Quick Check <span className="text-red-400">*</span>
                  </label>
                  <p className="text-sm text-stone-400 mb-2">
                    What is the city where BrewHub is located?
                  </p>
                  <input
                    id="vibe_check"
                    name="vibe_check"
                    type="text"
                    required
                    value={form.vibe_check}
                    onChange={handleChange}
                    placeholder="Type the city name…"
                    className="w-full px-4 py-3 rounded-lg border border-stone-700 bg-stone-800 text-white placeholder-stone-600 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/50 transition"
                  />
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={loading || uploading}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-lg font-bold text-sm tracking-widest uppercase bg-amber-600 hover:bg-amber-500 text-white active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                >
                  {uploading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Uploading resume…
                    </>
                  ) : loading ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      Submitting…
                    </>
                  ) : (
                    <>
                      <Send size={16} /> Apply Now
                    </>
                  )}
                </button>

                <p className="text-center text-xs text-stone-600 pt-1">
                  Your information is handled per our{" "}
                  <Link
                    href="/privacy"
                    className="underline underline-offset-2 hover:text-stone-400 transition-colors"
                  >
                    Privacy Policy
                  </Link>
                  .
                </p>
              </form>
            </>
          )}
        </div>

        <div className="text-center mt-8">
          <Link
            href="/"
            className="text-sm text-stone-600 hover:text-amber-400 transition-colors"
          >
            ← Back to BrewHub
          </Link>
        </div>
      </div>
    </div>
  );
}
