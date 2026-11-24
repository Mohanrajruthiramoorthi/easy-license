import { useEffect, useState } from 'react';
import { AuthProvider, useAuth } from './auth';
import { errText, fmtBizNo, fmtDate, latestLicence, licenceBadge, normalisePhone, supabase } from './lib';
import { Badge, Field, Form, Status, Toaster, toast } from './ui';
import { ShowDeletedCtx, useData } from './pages/data';
import { ActivityPage } from './pages/Activity';
import { Overview } from './pages/Overview';
import { BusinessDetail, Businesses, OwnerProfile } from './pages/Businesses';
import { LicencesPage, PaymentsPage, UsersPage } from './pages/Tables';

const GoogleMark = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"/></svg>
);

function SignIn() {
  const { signInWithGoogle, notice } = useAuth();
  return (
    <div className="gate"><div className="gatecard">
      <div><h1>Licence Desk</h1><p style={{ marginTop: 6 }}>Sign in with Google to manage businesses, licences, payments and users.</p></div>
      <button className="gbtn" onClick={signInWithGoogle}><GoogleMark />Continue with Google</button>
      {notice && <div className="notice bad" role="alert" style={{ margin: 0 }}>{notice}</div>}
    </div></div>
  );
}

function Register() {
  const { session, signOut, refresh } = useAuth();
  const meta = (session?.user.user_metadata ?? {}) as { full_name?: string; name?: string };
  const [f, setF] = useState({ biz: '', name: meta.full_name || meta.name || '', phone: '' });
  return (
    <div className="gate"><div className="gatecard">
      <div><h1>Register your business</h1><p style={{ marginTop: 6 }}>Signed in as {session?.user.email}. You get a 14-day trial straight away.</p></div>
      <Form submitLabel="Register" onCancel={signOut} onSubmit={async () => {
        if (!f.biz.trim() || !f.name.trim()) throw new Error('Business name and your name are required.');
        const phone = normalisePhone(f.phone);
        if (!phone) throw new Error('Enter a valid phone number, for example 9840011223 or +919840011223.');
        const { data, error } = await supabase.functions.invoke('register', { body: { business_name: f.biz.trim(), name: f.name.trim(), phone } });
        if (error) throw new Error(await errText(error));
        await refresh();
        toast(`Registered. Your business number is ${fmtBizNo(data.business_no)}. Your 14-day trial has started.`);
      }}>
        <Field label="Business name"><input id="rBiz" value={f.biz} onChange={(e) => setF({ ...f, biz: e.target.value })} autoFocus /></Field>
        <Field label="Your name"><input id="rName" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Business phone"><input id="rPhone" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="9840011223" /></Field>
      </Form>
    </div></div>
  );
}

const hashNow = () => window.location.hash.replace(/^#/, '');

const BLOCK_TEXT: Record<string, string> = {
  user_held: 'Your account has been put on hold by Licence Desk support.',
  owner_held: 'Your business account is on hold. Please contact your business owner.',
  business_held: 'Your business account has been put on hold by Licence Desk support.',
  licence_held: 'Your licence has been put on hold by Licence Desk support.',
  user_inactive: 'Your account is inactive.',
  business_deleted: 'This business account has been closed.',
};
const READ_ONLY_TEXT: Record<string, string> = {
  licence_expired: 'Your licence has expired. You can view your data, but you cannot make changes until it is renewed.',
  no_licence: 'There is no licence on this business yet. You can view your data, but you cannot enrol users.',
  licence_pending: 'Your licence has not started yet. You can view your data, but you cannot enrol users.',
  licence_revoked: 'Your licence was revoked. You can view your data, but you cannot make changes.',
};

function Locked() {
  const { access, profile, signOut, refresh } = useAuth();
  return (
    <div className="gate"><div className="gatecard">
      <div><h1>Access is on hold</h1><p style={{ marginTop: 6 }}>{BLOCK_TEXT[access?.reason ?? ''] ?? 'Your access is currently paused.'}</p></div>
      <p className="hint">Signed in as {profile?.email}. Contact support to resolve this. Your data is safe.</p>
      <div className="actions"><button className="btn ghost" onClick={signOut}>Sign out</button><button className="btn" onClick={refresh}>Check again</button></div>
    </div></div>
  );
}

function Shell() {
  const { profile, access, signOut } = useAuth();
  const me = profile!;
  const admin = me.role === 'super_admin';
  const [route, setRoute] = useState(hashNow() || (admin ? 'overview' : 'team'));
  const [showDeleted, setShowDeleted] = useState(false);
  const { data, error, loading, reload } = useData();
  useEffect(() => { const h = () => setRoute(hashNow() || (admin ? 'overview' : 'team')); window.addEventListener('hashchange', h); return () => window.removeEventListener('hashchange', h); }, [admin]);
  const go = (r: string) => { window.location.hash = r; };

  const nav = admin
    ? [['overview', 'Overview'], ['businesses', 'Businesses'], ['users', 'Users'], ['licences', 'Licences'], ['payments', 'Payments'], ['activity', 'Activity']]
    : [['team', 'Team'], ['activity', 'Activity']];
  const section = route.startsWith('business-') ? 'businesses' : route;

  let body: JSX.Element | null = null;
  if (data) {
    if (!admin) {
      const l = me.business_id ? latestLicence(data.licences, me.business_id) : undefined; const s = licenceBadge(l);
      const biz = data.businesses.find((b) => b.id === me.business_id);
      const readOnly = access?.mode === 'read_only';
      if (route === 'activity') body = <ActivityPage d={data} admin={false} myBusinessId={me.business_id} />;
      else body = (<>
        {readOnly && <div className="notice warn" role="status">{READ_ONLY_TEXT[access!.reason] ?? 'Your account is read-only right now.'}</div>}
        <div className={'notice ' + (s.tone === 'ok' ? 'ok' : s.tone === 'warn' ? 'warn' : 'bad')}>
          <strong>{biz ? `${biz.name} (${fmtBizNo(biz.business_no)})` : 'Your business'}</strong>: <Badge tone={s.tone}>{s.label}</Badge> {l ? `until ${fmtDate(l.effective_expiry_date)}` : ''}
          {l && l.paused_days > 0 && ` (includes ${l.paused_days} day${l.paused_days === 1 ? '' : 's'} added back after a hold)`}
        </div>
        {biz && <OwnerProfile b={biz} reload={reload} />}
        <UsersPage d={data} me={me} reload={reload} />
      </>);
    } else if (route.startsWith('business-')) body = <BusinessDetail d={data} id={route.slice(9)} go={go} reload={reload} />;
    else if (route === 'businesses') body = <Businesses d={data} go={go} reload={reload} />;
    else if (route === 'users') body = <UsersPage d={data} me={me} reload={reload} />;
    else if (route === 'licences') body = <LicencesPage d={data} reload={reload} />;
    else if (route === 'payments') body = <PaymentsPage d={data} reload={reload} />;
    else if (route === 'activity') body = <ActivityPage d={data} admin myBusinessId={null} />;
    else body = <Overview d={data} go={go} />;
  }

  return (
    <ShowDeletedCtx.Provider value={admin && showDeleted}>
      <div className="shell">
        <aside className="rail">
          <div className="brand"><b>Licence Desk</b><span>{admin ? 'App owner' : 'Business owner'}</span></div>
          <nav aria-label="Sections">{nav.map(([k, label]) => <button key={k} aria-current={section === k ? 'page' : undefined} onClick={() => go(k)}>{label}</button>)}</nav>
          {admin && <label className="checkrow railcheck"><input id="showDeleted" type="checkbox" checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} /> Show deleted</label>}
          <div className="me"><div><b>{me.name}</b>{me.email}</div><button onClick={signOut}>Sign out</button></div>
        </aside>
        <main>
          <Status loading={loading && !data} error={error} onRetry={reload} />
          {body}
        </main>
      </div>
    </ShowDeletedCtx.Provider>
  );
}

function Gate() {
  const { phase } = useAuth();
  if (phase === 'loading') return <div className="loading">Loading...</div>;
  if (phase === 'signed_out') return <SignIn />;
  if (phase === 'register') return <Register />;
  if (phase === 'blocked') return <Locked />;
  return <Shell />;
}

export default function App() {
  return <AuthProvider><Gate /><Toaster /></AuthProvider>;
}
