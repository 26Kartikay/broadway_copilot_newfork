import type { PrismaClient } from '@prisma/client';

/** Matches Prisma `Gender` enum. */
export type BulkGender = 'MALE' | 'FEMALE' | 'OTHER';
/** Matches Prisma `AgeGroup` enum (not numeric age). */
export type BulkAgeGroup = 'TEEN' | 'ADULT' | 'SENIOR';

const GENDERS: BulkGender[] = ['MALE', 'FEMALE', 'OTHER'];
const AGE_GROUPS: BulkAgeGroup[] = ['TEEN', 'ADULT', 'SENIOR'];

/** Normalize CSV header for stable column keys. */
export function normalizeCsvHeader(h: string): string {
  return h.trim().replace(/^\ufeff/, '').replace(/\s+/g, '_').toLowerCase();
}

function pick(row: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = row[k];
    if (v === undefined || v === null) continue;
    const s = String(v).trim();
    if (s !== '') return s;
  }
  return undefined;
}

function parseGender(
  s: string | undefined,
): { ok: true; value: BulkGender | undefined } | { ok: false; error: string } {
  if (s === undefined) return { ok: true, value: undefined };
  const u = s.toUpperCase();
  if (GENDERS.includes(u as BulkGender)) return { ok: true, value: u as BulkGender };
  return { ok: false, error: `Invalid gender "${s}" (use MALE, FEMALE, or OTHER)` };
}

function parseAgeGroup(
  s: string | undefined,
): { ok: true; value: BulkAgeGroup | undefined } | { ok: false; error: string } {
  if (s === undefined) return { ok: true, value: undefined };
  const u = s.toUpperCase();
  if (AGE_GROUPS.includes(u as BulkAgeGroup)) return { ok: true, value: u as BulkAgeGroup };
  return { ok: false, error: `Invalid age_group "${s}" (use TEEN, ADULT, or SENIOR)` };
}

export type ParsedBulkUserRow =
  | {
      ok: true;
      appUserId: string;
      whatsappFromCsv: string | undefined;
      profileName: string;
      details: string;
      isGuest: boolean;
      gender: BulkGender | undefined;
      ageGroup: BulkAgeGroup | undefined;
    }
  | { ok: false; error: string; raw: Record<string, unknown> };

export function parseBulkUserRow(row: Record<string, unknown>): ParsedBulkUserRow {
  const appUserId = pick(row, ['app_user_id', 'appuserid', 'user_id', 'userid']);
  if (!appUserId) {
    return { ok: false, error: 'Missing app user id (column app_user_id or user_id)', raw: row };
  }

  const profileName = pick(row, ['profile_name', 'name', 'fullname']) ?? '';
  const whatsappFromCsv = pick(row, ['whatsapp_id', 'whatsappid', 'phone', 'whatsapp']);
  const details = pick(row, ['details']) ?? '';

  const isGuestRaw = pick(row, ['is_guest', 'isguest', 'guest']);
  const isGuest = isGuestRaw ? ['true', '1', 'yes'].includes(isGuestRaw.toLowerCase()) : false;

  const g = parseGender(pick(row, ['gender', 'confirmed_gender', 'user_gender']));
  if (!g.ok) return { ok: false, error: g.error, raw: row };

  const a = parseAgeGroup(pick(row, ['age_group', 'agegroup', 'confirmed_age_group']));
  if (!a.ok) return { ok: false, error: a.error, raw: row };

  return {
    ok: true,
    appUserId,
    whatsappFromCsv,
    profileName,
    details,
    isGuest,
    gender: g.value,
    ageGroup: a.value,
  };
}

export async function upsertBulkUser(prisma: PrismaClient, parsed: Extract<ParsedBulkUserRow, { ok: true }>) {
  const whatsappIdForCreate = parsed.whatsappFromCsv ?? `bulk-wa:${parsed.appUserId}`;

  await prisma.user.upsert({
    where: { appUserId: parsed.appUserId },
    create: {
      appUserId: parsed.appUserId,
      whatsappId: whatsappIdForCreate,
      profileName: parsed.profileName,
      details: parsed.details,
      isGuest: parsed.isGuest,
      confirmedGender: parsed.gender ?? null,
      confirmedAgeGroup: parsed.ageGroup ?? null,
    },
    update: {
      profileName: parsed.profileName,
      details: parsed.details,
      isGuest: parsed.isGuest,
      ...(parsed.whatsappFromCsv ? { whatsappId: parsed.whatsappFromCsv } : {}),
      ...(parsed.gender !== undefined ? { confirmedGender: parsed.gender } : {}),
      ...(parsed.ageGroup !== undefined ? { confirmedAgeGroup: parsed.ageGroup } : {}),
    },
  });
}
