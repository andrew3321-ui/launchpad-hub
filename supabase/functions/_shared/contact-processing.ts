import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export const validSources = ["activecampaign", "manychat", "uchat", "manual"] as const;

export type ValidSource = (typeof validSources)[number];
type JsonRecord = Record<string, unknown>;

export interface IncomingContact {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface IncomingEventBody {
  launchId?: string;
  launchSlug?: string;
  source: ValidSource;
  eventType?: string;
  externalContactId?: string | null;
  contact?: IncomingContact;
  payload?: JsonRecord;
}

interface DedupeSettingsRow {
  compare_digits_only: boolean;
  auto_add_country_code: boolean;
  default_country_code: string;
  auto_add_ninth_digit: boolean;
  merge_on_exact_phone: boolean;
  merge_on_exact_email: boolean;
  auto_merge_duplicates: boolean;
  prefer_most_complete_record: boolean;
}

const defaultSettings: DedupeSettingsRow = {
  compare_digits_only: true,
  auto_add_country_code: true,
  default_country_code: "55",
  auto_add_ninth_digit: true,
  merge_on_exact_phone: true,
  merge_on_exact_email: true,
  auto_merge_duplicates: true,
  prefer_most_complete_record: true,
};

export interface ProcessIncomingContactResult {
  status: "processed" | "rejected";
  action?: "created" | "merged";
  contactId?: string | null;
  eventId?: string;
  logsCreated?: number;
  reason?: string;
}

export class ProcessContactError extends Error {
  statusCode: number;
  details?: string;

  constructor(message: string, statusCode = 500, details?: string) {
    super(message);
    this.name = "ProcessContactError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

function digitsOnly(value: string) {
  return value.replace(/\D/g, "");
}

function normalizeCountryCode(value: string) {
  const digits = digitsOnly(value);
  return digits || "55";
}

function addCountryCodeVariants(value: string, countryCode: string) {
  const digits = digitsOnly(value);
  if (!digits) return [];

  const variants = new Set<string>([digits]);

  if (digits.startsWith(countryCode)) {
    variants.add(digits.slice(countryCode.length));
  } else {
    variants.add(`${countryCode}${digits}`);
    if (digits.startsWith("0")) {
      variants.add(`${countryCode}${digits.slice(1)}`);
    }
  }

  return [...variants].filter(Boolean);
}

function addBrazilianNinthDigitVariants(value: string) {
  const digits = digitsOnly(value);
  if (!digits) return [];

  const variants = new Set<string>([digits]);

  if (/^[1-9]{2}[6-9]\d{7}$/.test(digits)) {
    variants.add(`${digits.slice(0, 2)}9${digits.slice(2)}`);
  }

  if (/^55[1-9]{2}[6-9]\d{7}$/.test(digits)) {
    variants.add(`55${digits.slice(2, 4)}9${digits.slice(4)}`);
  }

  if (/^[1-9]{2}9[6-9]\d{7}$/.test(digits)) {
    variants.add(`${digits.slice(0, 2)}${digits.slice(3)}`);
  }

  if (/^55[1-9]{2}9[6-9]\d{7}$/.test(digits)) {
    variants.add(`55${digits.slice(2, 4)}${digits.slice(5)}`);
  }

  return [...variants];
}

function generatePhoneCandidates(phone: string, settings: DedupeSettingsRow) {
  const base = settings.compare_digits_only ? digitsOnly(phone) : phone.trim();
  if (!base) return [];

  const queue = new Set<string>([base]);
  const countryCode = normalizeCountryCode(settings.default_country_code);

  if (settings.auto_add_country_code) {
    for (const current of [...queue]) {
      for (const variant of addCountryCodeVariants(current, countryCode)) {
        queue.add(variant);
      }
    }
  }

  if (settings.auto_add_ninth_digit) {
    for (const current of [...queue]) {
      for (const variant of addBrazilianNinthDigitVariants(current)) {
        queue.add(variant);
      }
    }
  }

  return [...queue].filter(Boolean);
}

function isLikelyValidPhone(candidate: string) {
  const digits = digitsOnly(candidate);
  return [10, 11, 12, 13].includes(digits.length);
}

function normalizeEmail(email?: string | null) {
  const value = email?.trim().toLowerCase();
  return value || null;
}

function normalizeName(name?: string | null) {
  const value = name?.trim();
  return value || null;
}

function pickCanonicalPhone(candidates: string[], countryCode: string) {
  if (candidates.length === 0) return null;

  const ordered = [...candidates].sort((left, right) => right.length - left.length);
  const withCountryCode = ordered.find((value) => value.startsWith(countryCode) && isLikelyValidPhone(value));
  return withCountryCode || ordered.find(isLikelyValidPhone) || ordered[0];
}

function scoreRecord(record: {
  primary_name?: string | null;
  primary_email?: string | null;
  primary_phone?: string | null;
  normalized_phone?: string | null;
  data?: unknown;
}) {
  const data = typeof record.data === "object" && record.data !== null ? (record.data as JsonRecord) : {};
  return [
    record.primary_name,
    record.primary_email,
    record.primary_phone,
    record.normalized_phone,
    ...Object.values(data),
  ].filter((value) => {
    if (typeof value === "string") return value.trim().length > 0;
    return value !== null && value !== undefined;
  }).length;
}

function chooseValue(
  currentValue: string | null | undefined,
  incomingValue: string | null | undefined,
  preferIncoming: boolean,
) {
  if (preferIncoming) return incomingValue || currentValue || null;
  return currentValue || incomingValue || null;
}

function asRecord(value: unknown) {
  return typeof value === "object" && value !== null ? (value as JsonRecord) : {};
}

function uniqueValues(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export async function processIncomingContactEvent(
  supabase: SupabaseClient,
  body: IncomingEventBody,
): Promise<ProcessIncomingContactResult> {
  if (!body.source || !validSources.includes(body.source)) {
    throw new ProcessContactError("Invalid source", 400);
  }

  if (!body.launchId && !body.launchSlug) {
    throw new ProcessContactError("launchId or launchSlug is required", 400);
  }

  const launchLookup = body.launchId
    ? supabase.from("launches").select("id, slug, name").eq("id", body.launchId).maybeSingle()
    : supabase.from("launches").select("id, slug, name").eq("slug", body.launchSlug).maybeSingle();

  const { data: launch, error: launchError } = await launchLookup;

  if (launchError || !launch) {
    throw new ProcessContactError("Launch not found", 404, launchError?.message);
  }

  const { data: settingsRow } = await supabase
    .from("launch_dedupe_settings")
    .select("*")
    .eq("launch_id", launch.id)
    .maybeSingle();

  const settings = (settingsRow as DedupeSettingsRow | null) || defaultSettings;
  const countryCode = normalizeCountryCode(settings.default_country_code);

  const normalizedEmail = normalizeEmail(body.contact?.email);
  const normalizedName = normalizeName(body.contact?.name);
  const rawPhone = body.contact?.phone?.trim() || null;
  const phoneCandidates = rawPhone ? generatePhoneCandidates(rawPhone, settings) : [];
  const validPhoneCandidates = phoneCandidates.filter(isLikelyValidPhone);
  const canonicalPhone = rawPhone ? pickCanonicalPhone(validPhoneCandidates, countryCode) : null;

  const { data: event, error: eventInsertError } = await supabase
    .from("inbound_contact_events")
    .insert({
      launch_id: launch.id,
      source: body.source,
      event_type: body.eventType || "contact_upsert",
      external_contact_id: body.externalContactId || null,
      payload: {
        contact: body.contact || {},
        payload: body.payload || {},
      },
    })
    .select("id")
    .single();

  if (eventInsertError || !event) {
    throw new ProcessContactError("Failed to create inbound event", 500, eventInsertError?.message);
  }

  const logs: Array<Record<string, unknown>> = [];

  if (rawPhone && validPhoneCandidates.length === 0) {
    logs.push({
      launch_id: launch.id,
      event_id: event.id,
      source: body.source,
      level: "warning",
      code: "INVALID_PHONE",
      title: "Numero invalido",
      message: `O contato recebido de ${body.source} possui um telefone que nao passou na validacao automatica.`,
      details: {
        receivedPhone: rawPhone,
        launchSlug: launch.slug,
      },
    });
  }

  if (!normalizedEmail && !canonicalPhone) {
    logs.push({
      launch_id: launch.id,
      event_id: event.id,
      source: body.source,
      level: "error",
      code: "UNIDENTIFIABLE_CONTACT",
      title: "Contato nao identificavel",
      message: "O evento nao trouxe email valido nem telefone utilizavel para deduplicacao.",
      details: {
        receivedPhone: rawPhone,
        receivedEmail: body.contact?.email || null,
      },
    });

    await supabase
      .from("inbound_contact_events")
      .update({
        processing_status: "error",
        processed_at: new Date().toISOString(),
        processing_summary: {
          action: "rejected",
          reason: "missing_valid_email_or_phone",
        },
      })
      .eq("id", event.id);

    if (logs.length > 0) {
      await supabase.from("contact_processing_logs").insert(logs);
    }

    return { status: "rejected", reason: "missing_valid_email_or_phone", eventId: event.id, logsCreated: logs.length };
  }

  const candidateIds = new Set<string>();

  if (normalizedEmail && settings.merge_on_exact_email) {
    const { data: emailMatches } = await supabase
      .from("lead_contacts")
      .select("id, primary_name, primary_email, primary_phone, normalized_phone, data")
      .eq("launch_id", launch.id)
      .eq("primary_email", normalizedEmail);

    emailMatches?.forEach((row) => candidateIds.add(row.id));
  }

  if (validPhoneCandidates.length > 0 && settings.merge_on_exact_phone) {
    const { data: phoneIdentityMatches } = await supabase
      .from("lead_contact_identities")
      .select("contact_id")
      .eq("launch_id", launch.id)
      .in("normalized_phone", validPhoneCandidates);

    phoneIdentityMatches?.forEach((row) => candidateIds.add(row.contact_id));

    const { data: phoneMatches } = await supabase
      .from("lead_contacts")
      .select("id")
      .eq("launch_id", launch.id)
      .in("normalized_phone", validPhoneCandidates);

    phoneMatches?.forEach((row) => candidateIds.add(row.id));
  }

  let existingContact: Record<string, unknown> | null = null;

  if (candidateIds.size > 0) {
    const { data: matchedContacts } = await supabase.from("lead_contacts").select("*").in("id", [...candidateIds]);

    if (matchedContacts && matchedContacts.length > 0) {
      existingContact = [...matchedContacts].sort((left, right) => scoreRecord(right) - scoreRecord(left))[0] as Record<
        string,
        unknown
      >;
    }
  }

  const incomingScore = scoreRecord({
    primary_name: normalizedName,
    primary_email: normalizedEmail,
    primary_phone: rawPhone,
    normalized_phone: canonicalPhone,
    data: body.payload || {},
  });

  let processedContactId: string | null = null;
  let action: "created" | "merged" = "created";

  if (existingContact && settings.auto_merge_duplicates) {
    const preferIncoming =
      settings.prefer_most_complete_record &&
      incomingScore >
        scoreRecord(
          existingContact as {
            primary_name?: string | null;
            primary_email?: string | null;
            primary_phone?: string | null;
            normalized_phone?: string | null;
            data?: unknown;
          },
        );

    const existingData = asRecord(existingContact.data);
    const existingPlatforms = asRecord(existingData.platforms);
    const mergedData = {
      ...existingData,
      latestPayload: body.payload || {},
      latestContact: {
        name: normalizedName,
        email: normalizedEmail,
        phone: rawPhone,
      },
      latestSource: body.source,
      lastEventType: body.eventType || "contact_upsert",
      sources: uniqueValues([
        ...(Array.isArray(existingData.sources) ? (existingData.sources as string[]) : []),
        body.source,
      ]),
      platforms: {
        ...existingPlatforms,
        [body.source]: {
          ...asRecord(existingPlatforms[body.source]),
          ...(body.payload || {}),
        },
      },
    };

    const { data: updatedContact, error: updateError } = await supabase
      .from("lead_contacts")
      .update({
        primary_name: chooseValue(existingContact.primary_name as string | null | undefined, normalizedName, preferIncoming),
        primary_email: chooseValue(existingContact.primary_email as string | null | undefined, normalizedEmail, preferIncoming),
        primary_phone: chooseValue(existingContact.primary_phone as string | null | undefined, rawPhone, preferIncoming),
        normalized_phone: chooseValue(
          existingContact.normalized_phone as string | null | undefined,
          canonicalPhone,
          preferIncoming,
        ),
        last_source: body.source,
        merged_from_count: Number(existingContact.merged_from_count || 0) + 1,
        data: mergedData,
      })
      .eq("id", existingContact.id as string)
      .select("id")
      .single();

    if (updateError || !updatedContact) {
      throw new ProcessContactError("Failed to merge contact", 500, updateError?.message);
    }

    processedContactId = updatedContact.id;
    action = "merged";

    logs.push({
      launch_id: launch.id,
      event_id: event.id,
      contact_id: processedContactId,
      source: body.source,
      level: "success",
      code: "DUPLICATE_CONTACT",
      title: "Contatos duplicados",
      message: `O evento de ${body.source} encontrou um contato ja existente e mesclou automaticamente os dados.`,
      details: {
        mergeReason: {
          emailMatched: Boolean(normalizedEmail && settings.merge_on_exact_email),
          phoneMatched: Boolean(validPhoneCandidates.length > 0 && settings.merge_on_exact_phone),
        },
        externalContactId: body.externalContactId || null,
      },
    });
  } else {
    const { data: createdContact, error: createError } = await supabase
      .from("lead_contacts")
      .insert({
        launch_id: launch.id,
        primary_name: normalizedName,
        primary_email: normalizedEmail,
        primary_phone: rawPhone,
        normalized_phone: canonicalPhone,
        first_source: body.source,
        last_source: body.source,
        data: {
          latestPayload: body.payload || {},
          latestContact: {
            name: normalizedName,
            email: normalizedEmail,
            phone: rawPhone,
          },
          latestSource: body.source,
          lastEventType: body.eventType || "contact_upsert",
          sources: [body.source],
          platforms: {
            [body.source]: body.payload || {},
          },
        },
      })
      .select("id")
      .single();

    if (createError || !createdContact) {
      throw new ProcessContactError("Failed to create contact", 500, createError?.message);
    }

    processedContactId = createdContact.id;

    logs.push({
      launch_id: launch.id,
      event_id: event.id,
      contact_id: processedContactId,
      source: body.source,
      level: "info",
      code: "CONTACT_IMPORTED",
      title: "Contato importado",
      message: `O contato recebido de ${body.source} foi salvo como um novo cadastro canonico.`,
      details: {
        externalContactId: body.externalContactId || null,
      },
    });
  }

  if (processedContactId) {
    if (body.externalContactId) {
      const { data: existingIdentity } = await supabase
        .from("lead_contact_identities")
        .select("id")
        .eq("launch_id", launch.id)
        .eq("source", body.source)
        .eq("external_contact_id", body.externalContactId)
        .maybeSingle();

      if (existingIdentity?.id) {
        await supabase
          .from("lead_contact_identities")
          .update({
            contact_id: processedContactId,
            external_email: normalizedEmail,
            external_phone: rawPhone,
            normalized_phone: canonicalPhone,
            raw_snapshot: body.payload || {},
          })
          .eq("id", existingIdentity.id);
      } else {
        await supabase.from("lead_contact_identities").insert({
          launch_id: launch.id,
          contact_id: processedContactId,
          source: body.source,
          external_contact_id: body.externalContactId,
          external_email: normalizedEmail,
          external_phone: rawPhone,
          normalized_phone: canonicalPhone,
          raw_snapshot: body.payload || {},
        });
      }
    } else {
      await supabase.from("lead_contact_identities").insert({
        launch_id: launch.id,
        contact_id: processedContactId,
        source: body.source,
        external_email: normalizedEmail,
        external_phone: rawPhone,
        normalized_phone: canonicalPhone,
        raw_snapshot: body.payload || {},
      });
    }
  }

  await supabase
    .from("inbound_contact_events")
    .update({
      processing_status: "processed",
      processed_contact_id: processedContactId,
      processed_at: new Date().toISOString(),
      processing_summary: {
        action,
        canonicalPhone,
        validPhoneCandidates,
      },
    })
    .eq("id", event.id);

  if (logs.length > 0) {
    await supabase.from("contact_processing_logs").insert(logs);
  }

  return {
    status: "processed",
    action,
    contactId: processedContactId,
    eventId: event.id,
    logsCreated: logs.length,
  };
}
