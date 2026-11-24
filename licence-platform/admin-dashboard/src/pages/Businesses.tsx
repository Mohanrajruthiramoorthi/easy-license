import { useState } from 'react';
import { Badge, Empty, PageHead } from '../ui';
import { Data, accountState, openHoldsFor, useShowDeleted, userName, vis } from './data';
import { AddBusinessModal, AddLicenceModal, EditBusinessModal, EnrolModal, useActions } from './modals';
import { Timeline } from './Activity';
import { BUSINESS_TYPES, Business, Hold, fmtBizNo, fmtDate, fmtDateTime, fmtMoney, isOpenHold, latestLicence, licenceBadge, reasonLabel } from '../lib';

export function Businesses({ d, go, reload }: { d: Data; go: (h: string) => void; reload: () => void }) {
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const show = useShowDeleted();
  const needle = q.trim().toLowerCase().replace(/^#/, '');
  const rows = vis(d.businesses, show).filter((b) => b.name.toLowerCase().includes(needle) || String(b.business_no).includes(needle));
  return (
    <>
      <PageHead title="Businesses" sub="Every customer, with licence status and team size." action={<button className="btn" onClick={() => setAdding(true)}>Add business</button>} />
      <section className="panel">
        <div className="toolbar"><input id="bizSearch" placeholder="Search by name or number" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search businesses" /></div>
        {rows.length === 0 ? <Empty title={d.businesses.length ? 'No match' : 'No businesses yet'} hint={d.businesses.length ? 'Try a different name.' : 'Add one, or wait for a registration.'} /> : (
          <div className="tablewrap"><table><thead><tr><th>No.</th><th>Business</th><th>Owner</th><th>Licence</th><th>Ends</th><th className="right">Users</th><th>Account</th></tr></thead><tbody>
            {rows.map((b) => {
              const l = latestLicence(d.licences, b.id); const s = licenceBadge(l); const acc = accountState(d, b);
              const owner = d.users.find((u) => u.id === b.owner_id);
              return (
                <tr key={b.id} className="click" onClick={() => go(`business-${b.id}`)}>
                  <td className="num">{fmtBizNo(b.business_no)}</td>
                  <td><strong>{b.name}</strong><span className="sub">{[b.city, b.state].filter(Boolean).join(', ') || `Added ${fmtDate(b.created_at)}`}</span></td>
                  <td>{owner ? <>{owner.name}<span className="sub">{owner.email}</span></> : <span className="sub">Not joined yet</span>}</td>
                  <td><Badge tone={s.tone}>{s.label}</Badge></td>
                  <td className="num">{l ? fmtDate(l.effective_expiry_date) : '-'}</td>
                  <td className="right num">{d.users.filter((u) => u.business_id === b.id && !u.deleted_at).length}</td>
                  <td><Badge tone={acc.tone}>{acc.label}</Badge></td>
                </tr>
              );
            })}
          </tbody></table></div>
        )}
      </section>
      {adding && <AddBusinessModal onClose={() => setAdding(false)} onDone={(id) => { setAdding(false); reload(); go(`business-${id}`); }} />}
    </>
  );
}

function HoldsPanel({ d, businessId, release }: { d: Data; businessId: string; release: (id: string) => void }) {
  const holds = d.holds.filter((h) => h.business_id === businessId);
  const target = (h: Hold) => h.target_type === 'business' ? 'Whole business' : h.target_type === 'licence' ? 'Licence' : userName(d, h.target_id);
  return (
    <section className="panel">
      <header><h2>Holds ({holds.filter(isOpenHold).length} open)</h2></header>
      {holds.length === 0 ? <Empty title="No holds" hint="Place a hold on the business, a licence or a user from this page." /> : (
        <div className="tablewrap"><table><thead><tr><th>On</th><th>Reason</th><th>Placed</th><th>Until</th><th></th></tr></thead><tbody>
          {holds.map((h) => (
            <tr key={h.id}>
              <td>{target(h)}<span className="sub">{h.rollover ? 'Held days are added back' : 'No expiry rollover'}</span></td>
              <td>{reasonLabel(h.reason_code)}{h.note && <span className="sub">{h.note}</span>}</td>
              <td className="num">{fmtDateTime(h.placed_at)}<span className="sub">by {userName(d, h.placed_by)}</span></td>
              <td className="num">{isOpenHold(h) ? (h.release_at ? `auto ${fmtDateTime(h.release_at)}` : 'until released') : <>released {fmtDateTime(h.released_at ?? h.release_at ?? h.placed_at)}{h.release_note && <span className="sub">{h.release_note}</span>}</>}</td>
              <td className="right">{isOpenHold(h) ? <button className="btn ghost small" onClick={() => release(h.id)}>Release</button> : <Badge tone="muted">ended</Badge>}</td>
            </tr>
          ))}
        </tbody></table></div>
      )}
    </section>
  );
}

export function BusinessDetail({ d, id, go, reload }: { d: Data; id: string; go: (h: string) => void; reload: () => void }) {
  const [modal, setModal] = useState<'' | 'enrol' | 'licence' | 'edit'>('');
  const show = useShowDeleted();
  const act = useActions(reload);
  const b = d.businesses.find((x) => x.id === id);
  if (!b) return <><button className="link back" onClick={() => go('businesses')}>Back to businesses</button><Empty title="Business not found" hint="It may not exist, or you may not have access." /></>;

  const users = vis(d.users.filter((u) => u.business_id === id), show);
  const invites = vis(d.invites.filter((i) => i.business_id === id), show);
  const licences = vis(d.licences.filter((l) => l.business_id === id), show);
  const payments = vis(d.payments.filter((p) => p.business_id === id), show);
  const l = latestLicence(d.licences, id); const s = licenceBadge(l); const acc = accountState(d, b);
  const owner = d.users.find((u) => u.id === b.owner_id);
  const bizHold = openHoldsFor(d, 'business', id);
  const done = () => { setModal(''); reload(); };

  return (
    <>
      <button className="link back" onClick={() => go('businesses')}>Back to businesses</button>
      <PageHead title={b.name} sub={`Business ${fmtBizNo(b.business_no)}. Added ${fmtDate(b.created_at)}.`} action={
        <div className="rowactions">
          {!b.deleted_at && (bizHold.length
            ? <button className="btn ghost" onClick={() => act.release(bizHold[0].id)}>Release business hold</button>
            : <button className="btn ghost" onClick={() => act.placeHold({ type: 'business', id, label: b.name })}>Hold business</button>)}
          {b.deleted_at ? <button className="btn ghost" onClick={() => act.restore('business', id, 'business')}>Restore business</button>
            : <button className="btn ghost" onClick={() => act.remove('business', id, 'business')}>Delete business</button>}
        </div>} />
      {b.deleted_at && <div className="notice bad">Deleted: {b.delete_reason}. Everyone in this business is blocked. Restore it to give access back.</div>}
      <section className="panel" style={{ marginBottom: 16 }}>
        <div className="kv">
          <div><span>Account</span><b><Badge tone={acc.tone}>{acc.label}</Badge></b></div>
          <div><span>Licence</span><b><Badge tone={s.tone}>{s.label}</Badge> {l && <span className="num">until {fmtDate(l.effective_expiry_date)}</span>}</b></div>
          <div><span>Owner</span><b>{owner ? `${owner.name} (${owner.email})` : 'Not joined yet'}</b></div>
          <div><span>Business no.</span><b className="num">{fmtBizNo(b.business_no)}</b></div>
          <div><span>Business ID (UUID)</span><b className="num" style={{ overflowWrap: 'anywhere' }}>{b.id}</b></div>
        </div>
      </section>

      <BusinessProfile b={b} onEdit={() => setModal('edit')} />

      <div className="stack" style={{ marginTop: 16 }}>
        <section className="panel">
          <header><h2>Team ({users.length + invites.length})</h2><button className="btn small" onClick={() => setModal('enrol')}>Enrol user</button></header>
          {users.length + invites.length === 0 ? <Empty title="No one here yet" hint="Enrol the business owner by their Google email." /> : (
            <div className="tablewrap"><table><thead><tr><th>Name</th><th>Role</th><th>Status</th><th></th></tr></thead><tbody>
              {invites.map((i) => (
                <tr key={i.id}><td>{i.name}<span className="sub">{i.email}</span></td><td>{i.role === 'business_owner' ? 'Owner' : 'User'}</td><td><Badge tone={i.deleted_at ? 'muted' : 'info'}>{i.deleted_at ? 'cancelled' : 'invited'}</Badge></td>
                  <td className="right">{i.deleted_at ? <button className="btn ghost small" onClick={() => act.restore('invite', i.id, 'invite')}>Restore</button> : <button className="btn ghost small" onClick={() => act.cancelInvite(i.id, i.email)}>Cancel invite</button>}</td></tr>
              ))}
              {users.map((u) => {
                const held = openHoldsFor(d, 'user', u.id);
                return (
                  <tr key={u.id}><td>{u.name}<span className="sub">{u.email}{u.phone ? ` / ${u.phone}` : ''}</span></td><td>{u.role === 'business_owner' ? 'Owner' : 'User'}</td>
                    <td>{u.deleted_at ? <Badge tone="muted">deleted</Badge> : held.length ? <Badge tone="bad">on hold</Badge> : <Badge tone={u.status === 'active' ? 'ok' : 'muted'}>{u.status}</Badge>}</td>
                    <td className="right rowactions">
                      {u.deleted_at ? <button className="btn ghost small" onClick={() => act.restore('user', u.id, 'user')}>Restore</button> : <>
                        {held.length ? <button className="btn ghost small" onClick={() => act.release(held[0].id)}>Release hold</button> : <button className="btn ghost small" onClick={() => act.placeHold({ type: 'user', id: u.id, label: u.name, isOwner: u.id === b.owner_id })}>Hold</button>}
                        <button className="btn ghost small" onClick={() => act.setStatus(u.id, u.status === 'active' ? 'inactive' : 'active', u.name)}>{u.status === 'active' ? 'Deactivate' : 'Activate'}</button>
                        <button className="btn ghost small" onClick={() => act.remove('user', u.id, 'user')}>Delete</button></>}
                    </td></tr>
                );
              })}
            </tbody></table></div>
          )}
        </section>

        <section className="panel">
          <header><h2>Licences</h2><button className="btn small" onClick={() => setModal('licence')}>Add licence</button></header>
          {licences.length === 0 ? <Empty title="No licence" hint="Without a live licence the owner can only view data and cannot enrol users." /> : (
            <div className="tablewrap"><table><thead><tr><th>Plan</th><th>Start</th><th>Expiry</th><th>State</th><th></th></tr></thead><tbody>
              {licences.map((x) => { const sb = licenceBadge(x); const lh = openHoldsFor(d, 'licence', x.id); return (
                <tr key={x.id}><td>{x.plan === 'trial' ? 'Trial' : 'Paid'}</td><td className="num">{fmtDate(x.start_date)}</td>
                  <td className="num">{fmtDate(x.effective_expiry_date)}{x.paused_days > 0 && <span className="sub">{fmtDate(x.expiry_date)} + {x.paused_days} day{x.paused_days === 1 ? '' : 's'} on hold</span>}</td>
                  <td><Badge tone={sb.tone}>{sb.label}</Badge></td>
                  <td className="right rowactions">
                    {x.deleted_at ? <button className="btn ghost small" onClick={() => act.restore('licence', x.id, 'licence')}>Restore</button> : <>
                      {x.status === 'active' && (lh.length ? <button className="btn ghost small" onClick={() => act.release(lh[0].id)}>Release hold</button> : <button className="btn ghost small" onClick={() => act.placeHold({ type: 'licence', id: x.id, label: `${x.plan} licence` })}>Hold</button>)}
                      {x.status !== 'revoked' && <button className="btn ghost small" onClick={() => act.revoke(x.id)}>Revoke</button>}
                      <button className="btn ghost small" onClick={() => act.remove('licence', x.id, 'licence')}>Delete</button></>}
                  </td></tr>); })}
            </tbody></table></div>
          )}
        </section>

        <section className="panel">
          <header><h2>Payments</h2><span className="sub" style={{ color: 'var(--muted)' }}>Recorded by the customer's app. Read-only here.</span></header>
          {payments.length === 0 ? <Empty title="No payments recorded" hint="They appear here when the customer's app reports them through the API." /> : (
            <div className="tablewrap"><table><thead><tr><th>Paid on</th><th>Status</th><th className="right">Amount</th></tr></thead><tbody>
              {payments.map((p) => (
                <tr key={p.id}><td className="num">{fmtDate(p.paid_on)}</td><td><Badge tone={p.status === 'paid' ? 'ok' : p.status === 'failed' ? 'bad' : 'warn'}>{p.status}</Badge></td><td className="right num">{fmtMoney(Number(p.amount))}</td></tr>
              ))}
            </tbody></table></div>
          )}
        </section>

        <HoldsPanel d={d} businessId={id} release={act.release} />

        <section className="panel">
          <header><h2>Activity</h2></header>
          <Timeline d={d} businessId={id} admin limit={50} />
        </section>
      </div>

      {modal === 'edit' && !b.deleted_at && <EditBusinessModal business={b} onClose={() => setModal('')} onDone={done} />}
      {modal === 'enrol' && <EnrolModal businessId={id} isAdmin onClose={() => setModal('')} onDone={done} />}
      {modal === 'licence' && <AddLicenceModal businessId={id} onClose={() => setModal('')} onDone={done} />}
      {act.node}
    </>
  );
}

export function BusinessProfile({ b, onEdit }: { b: Business; onEdit: () => void }) {
  const type = BUSINESS_TYPES.find(([k]) => k === b.business_type)?.[1] ?? null;
  const place = [b.address_line, [b.city, b.state].filter(Boolean).join(', '), [b.pincode, b.country !== 'IN' ? b.country : ''].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const rows: [string, string | null][] = [
    ['Legal name', b.legal_name], ['Type', type], ['Email', b.email], ['Phone', b.phone], ['Address', place || null],
    ['Website', b.website], ['GSTIN', b.gstin], ['Registration no.', b.registration_no],
  ];
  return (
    <section className="panel mb">
      <header><h2>Business profile</h2><button className="btn small ghost" onClick={onEdit}>Edit profile</button></header>
      <div className="kv">
        {rows.map(([k, v]) => <div key={k}><span>{k}</span>{v ? <b style={{ overflowWrap: 'anywhere' }}>{v}</b> : <b className="unset">Not set</b>}</div>)}
      </div>
    </section>
  );
}

export function OwnerProfile({ b, reload }: { b: Business; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <>
      <BusinessProfile b={b} onEdit={() => setEditing(true)} />
      {editing && <EditBusinessModal business={b} onClose={() => setEditing(false)} onDone={() => { setEditing(false); reload(); }} />}
    </>
  );
}
