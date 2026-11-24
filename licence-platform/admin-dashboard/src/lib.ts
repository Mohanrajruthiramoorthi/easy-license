import { createClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_KEY as string,
  { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } },
);

export type Role = 'super_admin' | 'business_owner' | 'user';
export interface Profile { id: string; business_id: string | null; name: string; email: string; phone: string | null; role: Role; status: 'active' | 'inactive'; created_at: string; deleted_at: string | null; delete_reason: string | null }
export interface Business {
  id: string; business_no: number; name: string; owner_id: string | null; created_at: string; deleted_at: string | null; delete_reason: string | null;
  legal_name: string | null; business_type: string | null; email: string | null; phone: string | null;
  address_line: string | null; city: string | null; state: string | null; pincode: string | null; country: string;
  website: string | null; gstin: string | null; registration_no: string | null;
}
export const BUSINESS_TYPES: [string, string][] = [['proprietorship', 'Proprietorship'], ['partnership', 'Partnership'], ['llp', 'LLP'], ['company', 'Company'], ['trust', 'Trust'], ['other', 'Other']];
export const fmtBizNo = (n: number) => `#${n}`;
/** 9840011223, 09840011223, 919840011223 and +919840011223 all become +919840011223. */
export function normalisePhone(raw: string): string | null {
  const s = raw.replace(/[\s()-]/g, '');
  if (/^\+[0-9]{8,15}$/.test(s)) return s;
  if (/^0?[6-9][0-9]{9}$/.test(s)) return '+91' + s.slice(-10);
  if (/^91[6-9][0-9]{9}$/.test(s)) return '+' + s;
  return null;
}
export interface LicenceRow {
  id: string; business_id: string; start_date: string; expiry_date: string; plan: 'trial' | 'paid'; status: 'pending' | 'active' | 'revoked';
  created_at: string; deleted_at: string | null; valid_until: string | null; effective_expiry_date: string; paused_days: number; is_held: boolean;
  state: 'active' | 'expired' | 'held' | 'revoked' | 'pending' | 'deleted';
}
export interface Payment { id: string; business_id: string; paid_on: string; amount: number; status: 'paid' | 'failed' | 'refunded'; created_at: string; deleted_at: string | null }
export interface Invite { id: string; business_id: string; email: string; name: string; phone: string | null; role: 'business_owner' | 'user'; created_at: string; claimed_at: string | null; deleted_at: string | null }
export type HoldTarget = 'licence' | 'business' | 'user';
export interface Hold {
  id: string; target_type: HoldTarget; target_id: string; business_id: string; reason_code: string; note: string | null; rollover: boolean;
  placed_by: string | null; placed_at: string; release_at: string | null; released_by: string | null; released_at: string | null; release_note: string | null;
}
export const HOLD_REASONS: [string, string][] = [['non_payment', 'Non-payment'], ['policy', 'Policy'], ['security', 'Security'], ['customer_request', 'Customer request'], ['investigation', 'Investigation'], ['other', 'Other']];
export const reasonLabel = (c: string) => HOLD_REASONS.find(([k]) => k === c)?.[1] ?? c;
export const isOpenHold = (h: Hold) => !h.released_at && (!h.release_at || Date.parse(h.release_at) > Date.now());
export interface TimelineRow {
  at: string; kind: 'change' | 'event'; what: string; actor_id: string | null; actor_role: string | null; reason: string | null; outcome: string | null;
  business_id: string | null; row_id: string | null; changed_columns: string[] | null; source: string | null; ip: string | null;
}
export interface Access { mode: 'full' | 'read_only' | 'blocked'; reason: string; valid_until: string | null; business: { id: string; business_no: number; name: string } | null }

export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
export const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
export const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
export const fmtDate = (iso: string | null | undefined) => iso ? new Date(iso.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '-';
export const fmtMoney = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);

export type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'info';
export function licenceBadge(l: LicenceRow | undefined): { label: string; tone: Tone; days: number | null } {
  if (!l) return { label: 'No licence', tone: 'muted', days: null };
  const days = daysBetween(today(), l.effective_expiry_date);
  switch (l.state) {
    case 'held': return { label: 'On hold', tone: 'bad', days };
    case 'expired': return { label: 'Expired', tone: 'bad', days };
    case 'revoked': return { label: 'Revoked', tone: 'bad', days };
    case 'pending': return { label: 'Pending', tone: 'muted', days };
    case 'deleted': return { label: 'Deleted', tone: 'muted', days };
    default: return { label: l.plan === 'trial' ? 'Trial' : 'Active', tone: days <= 14 ? 'warn' : 'ok', days };
  }
}

/** The licence that currently counts for a business: live ones first, then the one ending last. */
export function latestLicence(list: LicenceRow[], businessId: string): LicenceRow | undefined {
  return list.filter((l) => l.business_id === businessId && !l.deleted_at)
    .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || b.effective_expiry_date.localeCompare(a.effective_expiry_date))[0];
}

/** Run a database command (a cmd_* function). Errors carry the database's plain-English message. */
export async function cmd<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}

export async function errText(error: unknown): Promise<string> {
  const e = error as { message?: string; context?: { json?: () => Promise<{ error?: string }> } };
  try { const j = await e.context?.json?.(); if (j?.error) return j.error; } catch { /* ignore */ }
  return e?.message || 'Something went wrong';
}

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(async () => {
    setLoading(true);
    try { setData(await fn()); setError(null); }
    catch (e) { setError(await errText(e)); }
    finally { setLoading(false); }
  }, deps);
  useEffect(() => { void run(); }, [run]);
  return { data, error, loading, reload: run };
}

export async function must<T>(q: PromiseLike<{ data: T | null; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as T;
}
