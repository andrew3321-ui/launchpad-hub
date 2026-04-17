export const MEGAFONE_ALLOWED_EMAIL_DOMAIN = "@megafone.digital";

export const MEGAFONE_BOOTSTRAP_ADMIN_EMAILS = [
  "andrehugo@megafone.digital",
  "victorbezerra@megafone.digital",
  "joaofelipeoliveira@megafone.digital",
] as const;

export function normalizeMegafoneEmail(email: string) {
  return email.trim().toLowerCase();
}

export function isMegafoneEmail(email: string) {
  const normalized = normalizeMegafoneEmail(email);
  return normalized.endsWith(MEGAFONE_ALLOWED_EMAIL_DOMAIN);
}

export function isBootstrapMegafoneAdmin(email: string) {
  const normalized = normalizeMegafoneEmail(email);
  return MEGAFONE_BOOTSTRAP_ADMIN_EMAILS.includes(
    normalized as (typeof MEGAFONE_BOOTSTRAP_ADMIN_EMAILS)[number],
  );
}
