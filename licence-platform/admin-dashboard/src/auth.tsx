import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { Access, errText, Profile, supabase } from './lib';

type Phase = 'loading' | 'signed_out' | 'register' | 'ready' | 'blocked';
interface Ctx {
  phase: Phase; session: Session | null; profile: Profile | null; access: Access | null; notice: string;
  signInWithGoogle: () => Promise<void>; signOut: () => Promise<void>; refresh: () => Promise<void>;
}
const AuthCtx = createContext<Ctx>(null as unknown as Ctx);
export const useAuth = () => useContext(AuthCtx);

interface MyContext { mode: Access['mode']; reason: string; valid_until: string | null; profile: Profile | null; business: Access['business'] }

export function AuthProvider({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [access, setAccess] = useState<Access | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); if (!data.session) setPhase('signed_out'); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => { setSession(s); if (!s) { setProfile(null); setAccess(null); setPhase('signed_out'); } });
    return () => sub.subscription.unsubscribe();
  }, []);

  const bounce = useCallback(async (msg: string) => {
    setNotice(msg); setProfile(null); setAccess(null); setPhase('signed_out');
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
      if (!c.profile) {
        const { data, error } = await supabase.functions.invoke('claim-profile');
        if (error) return bounce(await errText(error));
        if (data?.status === 'claimed') c = await load();
        if (!c.profile) { setProfile(null); return setPhase('register'); }
      }
      if (c.profile.role === 'user') return bounce('This dashboard is for the app owner and business owners only.');
      setProfile(c.profile);
      setAccess({ mode: c.mode, reason: c.reason, valid_until: c.valid_until, business: c.business });
      setNotice('');
      setPhase(c.mode === 'blocked' ? 'blocked' : 'ready');
    } catch (e) { await bounce((e as Error).message); }
  }, [bounce]);

  useEffect(() => { if (session) void resolve(); }, [session?.user.id, resolve]); // eslint-disable-line react-hooks/exhaustive-deps

  const value: Ctx = {
    phase, session, profile, access, notice,
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
