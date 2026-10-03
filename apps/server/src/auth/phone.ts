/** Українські номери: `0XXXXXXXXX`, `380XXXXXXXXX`, `+380…` чи 9 цифр → `+380XXXXXXXXX`. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length === 9) return `+380${digits}`;
  if (digits.length === 10 && digits.startsWith('0')) return `+380${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith('380')) return `+${digits}`;
  return null;
}

/** Ім'я: 2–40 символів без пробілів по краях. */
export function normalizeName(input: string): string | null {
  const name = input.trim();
  return name.length >= 2 && name.length <= 40 ? name : null;
}
