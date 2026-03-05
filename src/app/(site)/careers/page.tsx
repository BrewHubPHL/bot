"use client";

import Link from "next/link";
import { useActionState, useState, useEffect, useRef } from "react";
import { submitCareerApplication, initialState } from "@/app/actions/career-actions";
import { Briefcase, Send, CheckCircle, ShieldCheck, Paperclip, FileText, Loader2 } from "lucide-react";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

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

export default function CareersPage() {
  const [state, formAction, isPending] = useActionState(submitCareerApplication, initialState);
  const [honeypot, setHoneypot] = useState("");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const loadTimeRef = useRef(Date.now());
  const fileInputRef = useRef<HTMLInputElement>(null);

  /* Capture mount timestamp for timing-based bot defense */
  useEffect(() => {
    loadTimeRef.current = Date.now();
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    if (file && file.size > MAX_FILE_SIZE) {
      setFileError("File is too large. Please upload a PDF under 5 MB.");
      e.target.value = "";
      setResumeFile(null);
      return;
    }
    if (file && file.type !== "application/pdf") {
      setFileError("Only PDF files are accepted.");
      e.target.value = "";
      setResumeFile(null);
      return;
    }
    setFileError("");
    setResumeFile(file);
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
          {state.success ? (
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
              {(state.error || fileError) && (
                <div className="mb-5 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                  {state.error || fileError}
                </div>
              )}

              <Dialog>
                <DialogTrigger asChild>
                  <Button variant="outline" className="mb-8 font-semibold">
                    What We&apos;re Looking For (Role &amp; Pay Tiers)
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                  <DialogHeader>
                    <DialogTitle className="text-2xl">Cafe &amp; Hub Operator</DialogTitle>
                    <DialogDescription className="text-base font-medium text-foreground mt-1">
                      $25.00/hr – $30.00/hr + Premium Stacking (OT &amp; Sunday Pay) + Tips
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-6 text-sm sm:text-base text-muted-foreground mt-4">
                    <section>
                      <h3 className="font-semibold text-foreground mb-2">Who We Are</h3>
                      <p>
                        BrewHub PHL isn&apos;t just another coffee shop. We are a highly automated, tech-forward neighborhood hub. We serve premium espresso, but we also run a secure Parcel Hub for the Point Breeze community. Our space is run by software we built ourselves, meaning less time dealing with clunky registers and more time connecting with the neighborhood.
                      </p>
                    </section>
                    <section>
                      <h3 className="font-semibold text-foreground mb-2">Role Overview</h3>
                      <p className="mb-2">
                        We believe the barista role is a high-skill position. Instead of &ldquo;throwing baristas to the wolves&rdquo; with poor onboarding, we offer a transparent two-tier system where compensation is tied to measurable milestones and leadership duties. By making firm decisions at the outset regarding pay, we eliminate the headache and heartache caused by erratic wage disparities. We value transparency and professional development as the core of our employee experience.
                      </p>
                      <p>
                        We are hiring for two distinct tiers. Both tiers require you to split your time between pulling perfect espresso shots and securely managing neighborhood package deliveries using our digital scanner system.
                      </p>
                    </section>
                    <section className="bg-muted/50 p-4 rounded-lg border">
                      <h4 className="font-bold text-foreground text-lg mb-1">Tier 1: Lead Barista ($25.00/hr)</h4>
                      <p className="italic mb-3">This tier is for experts in both technical precision and effortless hospitality.</p>
                      <ul className="list-disc pl-5 space-y-2">
                        <li><span className="font-medium text-foreground">Technical Standards:</span> Dial in espresso, steam milk to standard, demonstrate proficiency in latte art and pour-overs, and seamlessly navigate our custom iPad Kitchen Display System (KDS).</li>
                        <li><span className="font-medium text-foreground">The Hub (Logistics):</span> Use a Bluetooth scanner to securely check in packages (UPS, FedEx, USPS) and hand them off to residents verifying IDs.</li>
                        <li><span className="font-medium text-foreground">Hospitality:</span> Proven ability to read a room, turn upset customers into happy regulars, and maintain the &ldquo;Philly Real&rdquo; standard of hospitality.</li>
                        <li><span className="font-medium text-foreground">Professionalism:</span> High-level workplace communication that helps the entire team thrive.</li>
                      </ul>
                    </section>
                    <section className="bg-muted/50 p-4 rounded-lg border">
                      <h4 className="font-bold text-foreground text-lg mb-1">Tier 2: Barista Manager ($30.00/hr)</h4>
                      <p className="italic mb-3">This tier includes all technical and logistics expectations of Tier 1, plus human resource and operational oversight.</p>
                      <ul className="list-disc pl-5 space-y-2">
                        <li><span className="font-medium text-foreground">System Building:</span> Developing transparent compensation structures and setting beverage standards to avoid &ldquo;discord and confusion.&rdquo;</li>
                        <li><span className="font-medium text-foreground">Training &amp; Development:</span> Leading in-house training or education programs to help Tier 1 staff grow their skills.</li>
                        <li><span className="font-medium text-foreground">HR Functions:</span> Managing conflict, employee wellness, safety, and workplace communication.</li>
                        <li><span className="font-medium text-foreground">Operational Success:</span> Implementing strategies that result in lower turnover costs and higher sales.</li>
                      </ul>
                    </section>
                    <section>
                      <h3 className="font-semibold text-foreground mb-2">The Perks (The BrewHub Mutual Agreement)</h3>
                      <ul className="list-disc pl-5 space-y-2">
                        <li><span className="font-medium text-foreground">Automated Premium Pay:</span> 1.5x pay for overtime, 1.5x pay for Sundays, and 2.0x for Sunday overtime. (We literally built this into our payroll code—you never have to beg for your correct check).</li>
                        <li><span className="font-medium text-foreground">&ldquo;Just Cause&rdquo; Protections:</span> We don&apos;t do &ldquo;fired on a whim.&rdquo; We use progressive discipline. You have real job security.</li>
                        <li><span className="font-medium text-foreground">Free Coffee:</span> Obviously.</li>
                      </ul>
                    </section>
                  </div>
                </DialogContent>
              </Dialog>

              <form action={formAction} className="space-y-5">
                {/* Hidden bot-defense inputs */}
                <input type="hidden" name="formLoadedAt" value={loadTimeRef.current} />
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
                    defaultValue=""
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
                    placeholder="Type the city name…"
                    className="w-full px-4 py-3 rounded-lg border border-stone-700 bg-stone-800 text-white placeholder-stone-600 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/50 transition"
                  />
                </div>

                {/* Submit */}
                <button
                  type="submit"
                  disabled={isPending}
                  className="w-full flex items-center justify-center gap-2 py-3.5 rounded-lg font-bold text-sm tracking-widest uppercase bg-amber-600 hover:bg-amber-500 text-white active:scale-[0.99] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                >
                  {isPending ? (
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
