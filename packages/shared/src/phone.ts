/**
 * Uzbek phone numbers. MoySklad matches counterparties by exact string, so every number is stored as +998XXXXXXXXX
 * on both sides. Returns null for anything that is not a plausible Uzbek number.
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  let national: string;
  if (digits.length === 12 && digits.startsWith("998")) national = digits.slice(3);
  else if (digits.length === 9) national = digits;
  else if (digits.length === 10 && digits.startsWith("0")) national = digits.slice(1);
  else return null;
  if (!/^[1-9]\d{8}$/.test(national)) return null;
  return `+998${national}`;
}

/** "+998 90 123 45 67" for display. */
export function formatPhone(normalized: string): string {
  const m = /^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(normalized);
  return m ? `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : normalized;
}
