/**
 * Minimal className merger utility.
 * Joins truthy class strings with a space — no external dependencies needed.
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}
