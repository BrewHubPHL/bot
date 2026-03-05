"use server";

import { createClient } from "@supabase/supabase-js";

const MAX_NAME = 100;
const MAX_EMAIL = 254;
const MAX_PHONE = 20;
const MAX_TEXT = 2000;
const MAX_AVAILABILITY = 200;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const MIN_FORM_TIME_MS = 4000; // bot timing guard

export interface CareerFormState {
  error: string;
  success: boolean;
}

export const initialState: CareerFormState = {
  error: "",
  success: false,
};

/** Strip HTML tags and common injection patterns (mirrors _sanitize.js) */
function sanitize(str: string): string {
  let out = str.trim();
  out = out.replace(/<[^>]*>/g, "");
  out = out.replace(/\b(javascript|data|vbscript)\s*:/gi, "");
  out = out.replace(/\bon\w+\s*=/gi, "");
  out = out.replace(/&#(x?[0-9a-f]+);?/gi, "");
  out = out.replace(/\s{2,}/g, " ").trim();
  return out;
}

// SECURITY EXCEPTION: Public application form
export async function submitCareerApplication(
  prevState: CareerFormState,
  formData: FormData
): Promise<CareerFormState> {
  const name = sanitize(String(formData.get("name") ?? "").slice(0, MAX_NAME));
  const email = String(formData.get("email") ?? "").slice(0, MAX_EMAIL).trim();
  const phone = sanitize(String(formData.get("phone") ?? "").slice(0, MAX_PHONE));
  const availability = sanitize(
    String(formData.get("availability") ?? "").slice(0, MAX_AVAILABILITY)
  );
  const scenario_answer = sanitize(
    String(formData.get("scenario_answer") ?? "").slice(0, MAX_TEXT)
  );
  const vibe_check = String(formData.get("vibe_check") ?? "")
    .slice(0, MAX_AVAILABILITY)
    .trim();
  const honeypot = String(formData.get("user_zip_verification") ?? "");
  const loadTime = Number(formData.get("formLoadedAt") || 0);
  const resumeFile = formData.get("resume") as File | null;

  // ── Bot defense #1: honeypot ──
  if (honeypot) {
    return { error: "", success: true };
  }

  // ── Bot defense #2: timing ──
  if (loadTime > 0 && Date.now() - loadTime < MIN_FORM_TIME_MS) {
    return { error: "Please slow down and try again.", success: false };
  }

  // ── Bot defense #3: vibe check ──
  const vibeNorm = vibe_check.toLowerCase();
  if (!vibeNorm.includes("philadelphia") && !vibeNorm.includes("philly")) {
    return {
      error:
        "Incorrect answer to the quick check question. Hint: Think about where we are!",
      success: false,
    };
  }

  // ── Validate required fields ──
  if (!name) return { error: "Please enter your full name.", success: false };
  if (!email)
    return { error: "Please enter your email address.", success: false };
  if (!availability)
    return {
      error: "Please select your general availability.",
      success: false,
    };
  if (!scenario_answer)
    return {
      error: "Please answer the experience question.",
      success: false,
    };
  if (!vibe_check)
    return {
      error: "Please answer the quick check question.",
      success: false,
    };

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return { error: "Please provide a valid email address.", success: false };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // ── Upload resume if present ──
  let resume_url: string | null = null;

  if (resumeFile && resumeFile.size > 0) {
    if (resumeFile.size > MAX_FILE_SIZE) {
      return {
        error: "Resume file is too large. Please upload a PDF under 5 MB.",
        success: false,
      };
    }
    if (resumeFile.type !== "application/pdf") {
      return { error: "Only PDF files are accepted.", success: false };
    }

    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const filePath = `${Date.now()}-${slug}.pdf`;
    const buffer = Buffer.from(await resumeFile.arrayBuffer());

    const { error: uploadErr } = await supabase.storage
      .from("resumes")
      .upload(filePath, buffer, {
        contentType: "application/pdf",
        upsert: false,
      });

    if (uploadErr) {
      console.error("Resume upload error:", uploadErr.message);
      return { error: "Resume upload failed. Please try again.", success: false };
    }

    const { data: urlData } = supabase.storage
      .from("resumes")
      .getPublicUrl(filePath);
    resume_url = urlData.publicUrl;
  }

  // ── Insert into Supabase ──
  const { error: insertError } = await supabase
    .from("job_applications")
    .insert({
      name,
      email,
      phone: phone || null,
      availability,
      scenario_answer,
      resume_url,
      status: "pending",
    });

  if (insertError) {
    console.error("Career application insert error:", insertError.message);
    return {
      error: "Unable to submit application. Please try again.",
      success: false,
    };
  }

  return { error: "", success: true };
}
