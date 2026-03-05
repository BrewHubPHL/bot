/**
 * agreement-constants.ts — Single source of truth for the current
 * Mutual Working Agreement version tag.
 *
 * This value is embedded in every digital signature's SHA-256 hash
 * and stored in the agreement_signatures audit table. Changing it
 * is a governance event — all staff must re-sign.
 *
 * When updating:
 *   1. Bump CURRENT_AGREEMENT_VERSION below.
 *   2. Update the agreement template in _staff-agreement.js / staffAgreement.ts.
 *   3. Deploy — unsigned staff will be gated by the onboarding flow.
 */
export const CURRENT_AGREEMENT_VERSION = "2027-Q1";
