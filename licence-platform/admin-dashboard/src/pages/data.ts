import { createContext, useContext } from 'react';
import { Business, Hold, HoldTarget, Invite, LicenceRow, Payment, Profile, Tone, isOpenHold, must, supabase, useLoad } from '../lib';

export interface Data { businesses: Business[]; users: Profile[]; licences: LicenceRow[]; payments: Payment[]; invites: Invite[]; holds: Hold[] }

export function useData() {
  return useLoad<Data>(async () => {
    const [businesses, users, licences, payments, invites, holds] = await Promise.all([
      must<Business[]>(supabase.from('businesses').select('*').order('created_at', { ascending: false })),
      must<Profile[]>(supabase.from('users').select('*').order('created_at', { ascending: false })),
      must<LicenceRow[]>(supabase.from('licence_overview').select('*').order('effective_expiry_date', { ascending: false })),
      must<Payment[]>(supabase.from('payments').select('*').order('paid_on', { ascending: false })),
      must<Invite[]>(supabase.from('invites').select('*').is('claimed_at', null).order('created_at', { ascending: false })),
      must<Hold[]>(supabase.from('holds').select('*').order('placed_at', { ascending: false })),
    ]);
    return { businesses, users, licences, payments, invites, holds };
  });
}

export const nameOf = (d: Data, id: string) => d.businesses.find((b) => b.id === id)?.name ?? 'Unknown business';
export const userName = (d: Data, id: string | null) => (id ? d.users.find((u) => u.id === id)?.name ?? 'Unknown user' : 'System');

/** Deleted rows are hidden unless the app owner switches "Show deleted" on. */
export const ShowDeletedCtx = createContext(false);
export const useShowDeleted = () => useContext(ShowDeletedCtx);
export const vis = <T extends { deleted_at: string | null }>(rows: T[], show: boolean) => (show ? rows : rows.filter((r) => !r.deleted_at));

export const openHoldsFor = (d: Data, type: HoldTarget, id: string) => d.holds.filter((h) => h.target_type === type && h.target_id === id && isOpenHold(h));

export function accountState(d: Data, b: Business): { label: string; tone: Tone } {
  if (b.deleted_at) return { label: 'Deleted', tone: 'muted' };
  if (openHoldsFor(d, 'business', b.id).length) return { label: 'On hold', tone: 'bad' };
  if (b.owner_id && openHoldsFor(d, 'user', b.owner_id).length) return { label: 'Owner on hold', tone: 'bad' };
  return { label: 'Active', tone: 'ok' };
}
