import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Access, errText, MembershipCtx, Profile, supabase } from './lib';

type Phase = 'loading' | 'signed_out' | 'register' | 'ready' | 'blocked';
interface Ctx {
  phase: Phase; session: Session | null; profile: Profile | null; notice: string;
  /** Businesses this person owns (the dashboard is for the app owner and business owners). */
  owned: MembershipCtx[]; activeId: string | null; setActive: (businessId: string) => void;
  /** Access for the business currently selected. For the app owner it is always full. */
  access: Access | null;
  signInWithGoogle: () => Promise<void>; signOut: () => Promise<void>; refresh: () => Promise<void>;
}
const AuthCtx = createContext<Ctx>(null as unknown as Ctx);
export const useAuth = () => useContext(AuthCtx);

interface MyContext { mode: Access['mode']; reason: string; valid_until: string | null; profile: Profile | null; memberships: MembershipCtx[] }

const KEY = 'licence-desk.business';
const remembered = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const remember = (id: string) => { try { localStorage.setItem(KEY, id); } catch { /* ignore */ } };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [owned, setOwned] = useState<MembershipCtx[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [top, setTop] = useState<Access | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (!data.session) setPhase('signed_out'); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); if (!s) { setProfile(null); setOwned([]); setActiveId(null); setTop(null); setPhase('signed_out'); } });
    return () => sub.subscription.unsubscribe();
  }, []);

  const bounce = useCallback(async (msg: string) => {
    setNotice(msg); setProfile(null); setOwned([]); setActiveId(null); setTop(null); setPhase('signed_out');
    await supabase.auth.signOut();
  }, []);

  const load = async (): Promise<MyContext> => {
    const { data, error } = await supabase.rpc('my_context');
    if (error) throw new Error(error.message);
    return data as MyContext;
  };

  const resolve = useCallback(async () => {
    try {
      let c = await load();
      const isAdmin = c.profile?.role === 'super_admin';
      const hasOwned = (c.memberships ?? []).some((m) => m.role === 'business_owner');
      // New people, and people with no business yet, may have been invited: turn open invites into memberships.
      if (!isAdmin && !hasOwned && (!c.profile || c.reason === 'no_membership' || (c.memberships ?? []).length === 0)) {
        const { data, error } = await supabase.functions.invoke('claim-profile');
        if (error) return bounce(await errText(error));
        if (data?.status === 'deactivated') return bounce(data.message || 'This account has been deactivated. Contact support.');
        if (data?.status === 'claimed') c = await load();
      }
      if (!c.profile) { setProfile(null); return setPhase('register'); }
      setProfile(c.profile);
      setNotice('');
      if (c.profile.role === 'super_admin') {
        setOwned([]); setActiveId(null); setTop({ mode: c.mode, reason: c.reason, valid_until: c.valid_until });
        return setPhase(c.mode === 'blocked' ? 'blocked' : 'ready');
      }
      const memberships = c.memberships ?? [];
      if (c.mode === 'blocked' && memberships.length === 0 && c.reason !== 'no_membership') {
        setOwned([]); setTop({ mode: 'blocked', reason: c.reason, valid_until: null }); return setPhase('blocked');
      }
      if (memberships.length === 0) { setOwned([]); return setPhase('register'); }
      const mine = memberships.filter((m) => m.role === 'business_owner');
      if (mine.length === 0) return bounce('This dashboard is for the app owner and business owners only.');
      setOwned(mine);
      const saved = remembered();
      const pick = mine.find((m) => m.business.id === saved) ?? mine.find((m) => m.mode !== 'blocked') ?? mine[0];
      setActiveId((cur) => (cur && mine.some((m) => m.business.id === cur) ? cur : pick.business.id));
      setPhase(mine.every((m) => m.mode === 'blocked') ? 'blocked' : 'ready');
    } catch (e) { await bounce((e as Error).message); }
  }, [bounce]);

  useEffect(() => { if (session) void resolve(); }, [session?.user.id, resolve]); // eslint-disable-line react-hooks/exhaustive-deps

  const active = owned.find((m) => m.business.id === activeId) ?? owned.find((m) => m.mode !== 'blocked') ?? owned[0];
  const access: Access | null = profile?.role === 'super_admin' ? top : active ? { mode: active.mode, reason: active.reason, valid_until: active.valid_until } : top;

  const value: Ctx = {
    phase, session, profile, notice, owned, activeId: active?.business.id ?? null, access,
    setActive: (id) => { remember(id); setActiveId(id); },
    signInWithGoogle: async () => {
      setNotice('');
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
      if (error) setNotice(error.message);
    },
    signOut: async () => { await supabase.auth.signOut(); setPhase('signed_out'); },
    refresh: resolve,
  };
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}
