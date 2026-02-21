/**
 * Zero-dependency HTML entity escaper for transactional email templates.
 *
 * Replaces the five characters that can break out of HTML attribute
 * values or text nodes:  & < > " '
 *
 * Safe for both HTML body text and quoted attribute values.
 */

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const RE = /[&<>"']/g;

export function escapeHtml(str: unknown): string {
  if (str === null || str === undefined) return "";
  return String(str).replace(RE, (ch) => ENTITIES[ch]);
}
