export const MEGAFONE_ALLOWED_EMAIL_DOMAIN = "@megafone.digital";

export function normalizeMegafoneEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isMegafoneEmail(email: string) {
  const normalized = normalizeMegafoneEmail(email);
  return normalized.endsWith(MEGAFONE_ALLOWED_EMAIL_DOMAIN);
}
