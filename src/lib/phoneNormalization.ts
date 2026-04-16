export interface DedupeSettings {
  compareDigitsOnly: boolean;
  autoAddCountryCode: boolean;
  defaultCountryCode: string;
  autoAddNinthDigit: boolean;
  mergeOnExactPhone: boolean;
  mergeOnExactEmail: boolean;
  autoMergeDuplicates: boolean;
  preferMostCompleteRecord: boolean;
}

export const defaultDedupeSettings: DedupeSettings = {
  compareDigitsOnly: true,
  autoAddCountryCode: true,
  defaultCountryCode: "55",
  autoAddNinthDigit: true,
  mergeOnExactPhone: true,
  mergeOnExactEmail: true,
  autoMergeDuplicates: true,
  preferMostCompleteRecord: true,
};

export function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function normalizeCountryCode(value: string) {
  const digits = digitsOnly(value);
  return digits || "55";
}

function withCountryCode(value: string, countryCode: string) {
  const digits = digitsOnly(value);
  if (!digits) return [];

  const results = new Set<string>([digits]);

  if (digits.startsWith(countryCode)) {
    results.add(digits.slice(countryCode.length));
  } else {
    results.add(`${countryCode}${digits}`);
    if (digits.startsWith("0")) {
      results.add(`${countryCode}${digits.slice(1)}`);
    }
  }

  return [...results].filter(Boolean);
}

function addBrazilianNinthDigitVariants(value: string) {
  const digits = digitsOnly(value);
  if (!digits) return [];

  const results = new Set<string>([digits]);

  if (/^[1-9]{2}[6-9]\d{7}$/.test(digits)) {
    results.add(`${digits.slice(0, 2)}9${digits.slice(2)}`);
  }

  if (/^55[1-9]{2}[6-9]\d{7}$/.test(digits)) {
    results.add(`55${digits.slice(2, 4)}9${digits.slice(4)}`);
  }

  if (/^[1-9]{2}9[6-9]\d{7}$/.test(digits)) {
    results.add(`${digits.slice(0, 2)}${digits.slice(3)}`);
  }

  if (/^55[1-9]{2}9[6-9]\d{7}$/.test(digits)) {
    results.add(`55${digits.slice(2, 4)}${digits.slice(5)}`);
  }

  return [...results];
}

export function generatePhoneCandidates(phone: string, settings: DedupeSettings) {
  const base = settings.compareDigitsOnly  digitsOnly(phone) : phone.trim();
  if (!base) return [];

  const countryCode = normalizeCountryCode(settings.defaultCountryCode);
  const queue = new Set<string>([base]);

  if (settings.autoAddCountryCode) {
    for (const candidate of [...queue]) {
      for (const variant of withCountryCode(candidate, countryCode)) {
        queue.add(variant);
      }
    }
  }

  if (settings.autoAddNinthDigit) {
    for (const candidate of [...queue]) {
      for (const variant of addBrazilianNinthDigitVariants(candidate)) {
        queue.add(variant);
      }
    }
  }

  return [...queue].filter(Boolean);
}

export function mergePreferenceLabel(preferMostCompleteRecord: boolean) {
  return preferMostCompleteRecord
     "Mesclar priorizando o cadastro com mais campos preenchidos"
    : "Mesclar priorizando o cadastro mais antigo";
}
