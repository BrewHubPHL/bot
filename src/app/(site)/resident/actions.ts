"use server";

import { createClient } from "@supabase/supabase-js";

const MAX_NAME = 100;
const MAX_UNIT = 20;
const MAX_EMAIL = 254;
const MAX_PHONE = 20;
const MAX_PASSWORD = 128;
const MIN_FORM_TIME_MS = 2000; // bot timing guard

export interface ResidentFormState {
  error: string;
  success: boolean;
}

export const initialState: ResidentFormState = {
  error: "",
  success: false,
};

// SECURITY EXCEPTION: Public registration form
export async function submitResident(
  prevState: ResidentFormState,
  formData: FormData
): Promise<ResidentFormState> {
  const name = String(formData.get("name") ?? "").slice(0, MAX_NAME).trim();
  const unit = String(formData.get("unit") ?? "").slice(0, MAX_UNIT).trim();
  const email = String(formData.get("email") ?? "").slice(0, MAX_EMAIL).trim();
  const password = String(formData.get("password") ?? "").slice(0, MAX_PASSWORD);
  const confirm = String(formData.get("confirm") ?? "").slice(0, MAX_PASSWORD);
  const phone = String(formData.get("phone") ?? "").slice(0, MAX_PHONE).trim();
  const formLoadedAt = Number(formData.get("formLoadedAt") || 0);

  if (!name || !unit || !email || !password || !confirm) {
    return { error: "Please fill in all required fields.", success: false };
  }
  if (password !== confirm) {
    return { error: "Passwords do not match.", success: false };
  }
  // Bot timing guard — form submitted too fast
  if (formLoadedAt > 0 && Date.now() - formLoadedAt < MIN_FORM_TIME_MS) {
    return { error: "Please slow down and try again.", success: false };
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  // ── Phone duplicate / cross-unit conflict guard ──
  if (phone) {
    const { data: existingCustomer, error: lookupError } = await supabase
      .from("customers")
      .select("id, email, unit_number")
      .eq("phone", phone)
      .limit(1)
      .maybeSingle();

    if (lookupError) {
      console.error("Phone lookup error:", lookupError.message);
      // Non-fatal: continue and let DB constraint catch duplicates
    } else if (existingCustomer) {
      if (
        existingCustomer.unit_number &&
        unit &&
        existingCustomer.unit_number.trim().toLowerCase() !== unit.trim().toLowerCase()
      ) {
        return {
          error:
            "This phone number is already associated with a different unit. " +
            "Please contact building management at the front desk or email help@brewhubphl.com to resolve this.",
          success: false,
        };
      }
      if (existingCustomer.email) {
        return {
          error:
            "A resident with this phone number already exists. Please log in from the portal instead.",
          success: false,
        };
      }
      // Ghost record (no email) — allow registration to claim it
    }
  }

  // ── Register with Supabase Auth ──
  const { error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: name, unit_number: unit, phone },
    },
  });

  if (signUpError) {
    console.error("Resident signup error:", signUpError.message);
    const raw = signUpError.message.toLowerCase();
    if (raw.includes("already registered") || raw.includes("user already exists")) {
      return {
        error: "An account with this email already exists. Please sign in from the portal.",
        success: false,
      };
    }
    return { error: "Registration failed. Please try again.", success: false };
  }

  return { error: "", success: true };
}
