import { useState } from 'react';
import { Badge, Empty, PageHead } from '../ui';
import { Data, nameOf, openHoldsFor, useShowDeleted, vis } from './data';
import { EnrolModal, useActions } from './modals';
import { Profile, fmtDate, fmtMoney, licenceBadge } from '../lib';

export function UsersPage({ d, me, reload, businessId }: { d: Data; me: Profile; reload: () => void; businessId?: string | null }) {
  const admin = me.role === 'super_admin';
  const show = useShowDeleted();
  const act = useActions(reload);
  const [biz, setBiz] = useState('all'); const [role, setRole] = useState('all'); const [enrol, setEnrol] = useState(false);
  // An owner works inside one business at a time (chosen in the menu); the app owner can look across all of them.
  const scope = admin ? biz : (businessId ?? 'none');
  const members = vis(d.memberships, show).filter((m) => (scope === 'all' || m.business_id === scope) && (role === 'all' || m.role === role));
  const invites = vis(d.invites, show).filter((i) => scope === 'all' || i.business_id === scope);
  const target = scope !== 'all' && scope !== 'none' ? scope : '';
  const bizName = (id: string) => d.businesses.find((b) => b.id === id)?.name ?? 'this business';
  const person = (id: string) => d.users.find((u) => u.id === id);
  return (
    <>
      <PageHead title={admin ? 'Users' : 'Team'} sub={admin ? 'Everyone across all businesses. One person can belong to several.' : 'People in this business.'}
        action={target && <button className="btn" onClick={() => setEnrol(true)}>Add user</button>} />
      <section className="panel">
        <div className="toolbar">
          {admin && <select id="uBiz" aria-label="Business" value={biz} onChange={(e) => setBiz(e.target.value)}><option value="all">All businesses</option>{d.businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>}
          <select id="uRoleFilter" aria-label="Role" value={role} onChange={(e) => setRole(e.target.value)}><option value="all">All roles</option><option value="business_owner">Owners</option><option value="user">Users</option></select>
          {admin && biz === 'all' && <span className="sub" style={{ alignSelf: 'center', color: 'var(--muted)' }}>Pick a business to add someone.</span>}
        </div>
        {members.length + invites.length === 0 ? <Empty title="No users to show" /> : (
          <div className="tablewrap"><table><thead><tr><th>Name</th>{admin && <th>Business</th>}<th>Role</th><th>Phone</th><th>Status</th><th></th></tr></thead><tbody>
            {invites.map((i) => (
              <tr key={i.id}><td>{i.name}<span className="sub">{i.email}</span></td>{admin && <td>{nameOf(d, i.business_id)}</td>}<td>{i.role === 'business_owner' ? 'Owner' : 'User'}</td><td className="num">{i.phone || '-'}</td><td><Badge tone={i.deleted_at ? 'muted' : 'info'}>{i.deleted_at ? 'cancelled' : 'invited'}</Badge></td>
                <td className="right">{i.deleted_at ? (admin && <button className="btn ghost small" onClick={() => act.restore('invite', i.id, 'invite')}>Restore</button>) : <button className="btn ghost small" onClick={() => act.cancelInvite(i.id, i.email)}>Cancel invite</button>}</td></tr>
            ))}
            {members.map((m) => {
              const u = person(m.user_id);
              const name = u?.name ?? 'Unknown person';
              const mHeld = openHoldsFor(d, 'membership', m.id); const pHeld = openHoldsFor(d, 'user', m.user_id);
              const isOwnerHere = d.businesses.find((b) => b.id === m.business_id)?.owner_id === m.user_id;
              const canManage = m.user_id !== me.id && (admin || m.role === 'user');
              return (
                <tr key={m.id}><td>{name}<span className="sub">{u?.email}</span></td>{admin && <td>{nameOf(d, m.business_id)}</td>}<td>{m.role === 'business_owner' ? 'Owner' : 'User'}</td><td className="num">{u?.phone || '-'}</td>
                  <td>{m.deleted_at ? <Badge tone="muted">removed</Badge> : pHeld.length ? <Badge tone="bad">person on hold</Badge> : mHeld.length ? <Badge tone="bad">on hold</Badge> : <Badge tone={m.status === 'active' ? 'ok' : 'muted'}>{m.status}</Badge>}</td>
                  <td className="right rowactions">
                    {m.deleted_at ? (admin && <button className="btn ghost small" onClick={() => act.restore('membership', m.id, 'membership')}>Restore</button>) : canManage && <>
                      {admin && (mHeld.length ? <button className="btn ghost small" onClick={() => act.release(mHeld[0].id)}>Release hold</button> : <button className="btn ghost small" onClick={() => act.placeHold({ type: 'membership', id: m.id, label: `${name} in ${bizName(m.business_id)}`, isOwner: isOwnerHere })}>Hold here</button>)}
                      {admin && (pHeld.length ? <button className="btn ghost small" onClick={() => act.release(pHeld[0].id)}>Release person hold</button> : <button className="btn ghost small" onClick={() => act.placeHold({ type: 'user', id: m.user_id, label: name })}>Hold everywhere</button>)}
                      <button className="btn ghost small" onClick={() => act.setMemberStatus(m.id, m.status === 'active' ? 'inactive' : 'active', name)}>{m.status === 'active' ? 'Deactivate' : 'Activate'}</button>
                      <button className="btn ghost small" onClick={() => act.removeMember(m.id, name, bizName(m.business_id))}>Remove</button></>}
                  </td></tr>
              );
            })}
          </tbody></table></div>
        )}
      </section>
      {enrol && target && <EnrolModal businessId={target} isAdmin={admin} onClose={() => setEnrol(false)} onDone={() => { setEnrol(false); reload(); }} />}
      {act.node}
    </>
  );
}

export function LicencesPage({ d, reload }: { d: Data; reload: () => void }) {
  const [f, setF] = useState('all');
  const show = useShowDeleted();
  const act = useActions(reload);
  const rows = vis(d.licences, show).filter((l) => { const s = licenceBadge(l); return f === 'all' || (f === 'live' && (s.tone === 'ok' || s.tone === 'warn')) || (f === 'lapsed' && s.tone === 'bad') || (f === 'trial' && l.plan === 'trial'); });
  return (
    <>
      <PageHead title="Licences" sub="Trial and paid licences for every business. Held days are added back to the expiry." />
      <section className="panel">
        <div className="toolbar"><select id="lFilter" aria-label="Filter" value={f} onChange={(e) => setF(e.target.value)}><option value="all">All licences</option><option value="live">Live</option><option value="trial">Trials</option><option value="lapsed">Expired, held or revoked</option></select></div>
        {rows.length === 0 ? <Empty title="No licences match" /> : (
          <div className="tablewrap"><table><thead><tr><th>Business</th><th>Plan</th><th>Start</th><th>Expiry</th><th>State</th><th></th></tr></thead><tbody>
            {rows.map((l) => { const s = licenceBadge(l); const lh = openHoldsFor(d, 'licence', l.id); return (
              <tr key={l.id}><td>{nameOf(d, l.business_id)}</td><td>{l.plan === 'trial' ? 'Trial' : 'Paid'}</td><td className="num">{fmtDate(l.start_date)}</td>
                <td className="num">{fmtDate(l.effective_expiry_date)}{l.paused_days > 0 && <span className="sub">+{l.paused_days} day{l.paused_days === 1 ? '' : 's'} on hold</span>}</td>
                <td><Badge tone={s.tone}>{s.label}</Badge></td>
                <td className="right rowactions">
                  {l.deleted_at ? <button className="btn ghost small" onClick={() => act.restore('licence', l.id, 'licence')}>Restore</button> : <>
                    {l.status === 'active' && (lh.length ? <button className="btn ghost small" onClick={() => act.release(lh[0].id)}>Release hold</button> : <button className="btn ghost small" onClick={() => act.placeHold({ type: 'licence', id: l.id, label: `${nameOf(d, l.business_id)} licence` })}>Hold</button>)}
                    {l.status !== 'revoked' && <button className="btn ghost small" onClick={() => act.revoke(l.id)}>Revoke</button>}</>}
                </td></tr>); })}
          </tbody></table></div>
        )}
      </section>
      {act.node}
    </>
  );
}

export function PaymentsPage({ d, reload }: { d: Data; reload: () => void }) {
  const [biz, setBiz] = useState('all');
  const show = useShowDeleted();
  const act = useActions(reload);
  const rows = vis(d.payments, show).filter((p) => biz === 'all' || p.business_id === biz);
  const live = rows.filter((p) => !p.deleted_at);
  const total = live.filter((p) => p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0) - live.filter((p) => p.status === 'refunded').reduce((s, p) => s + Number(p.amount), 0);
  return (
    <>
      <PageHead title="Payments" sub="Recorded by each customer's own app through the API. Licence Desk only keeps the record; it does not take or process payments." />
      <section className="panel">
        <div className="toolbar"><select id="pFilter" aria-label="Business" value={biz} onChange={(e) => setBiz(e.target.value)}><option value="all">All businesses</option>{d.businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          <span className="num" style={{ alignSelf: 'center', marginLeft: 'auto' }}>Net recorded {fmtMoney(total)}</span></div>
        {rows.length === 0 ? <Empty title="No payments yet" hint="They appear here when a customer's app reports them." /> : (
          <div className="tablewrap"><table><thead><tr><th>Business</th><th>Paid on</th><th>Status</th><th className="right">Amount</th><th></th></tr></thead><tbody>
            {rows.map((p) => <tr key={p.id}><td>{nameOf(d, p.business_id)}</td><td className="num">{fmtDate(p.paid_on)}</td>
              <td>{p.deleted_at ? <Badge tone="muted">deleted</Badge> : <Badge tone={p.status === 'paid' ? 'ok' : p.status === 'failed' ? 'bad' : 'warn'}>{p.status}</Badge>}</td>
              <td className="right num">{fmtMoney(Number(p.amount))}</td>
              <td className="right">{p.deleted_at ? <button className="btn ghost small" onClick={() => act.restore('payment', p.id, 'payment')}>Restore</button> : <button className="btn ghost small" onClick={() => act.remove('payment', p.id, 'payment record')}>Delete</button>}</td></tr>)}
          </tbody></table></div>
        )}
      </section>
      {act.node}
    </>
  );
}
