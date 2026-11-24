import { Badge, Empty, PageHead } from '../ui';
import { Data, nameOf } from './data';
import { addDays, daysBetween, fmtDate, fmtMoney, latestLicence, licenceBadge, today } from '../lib';

export function Overview({ d, go }: { d: Data; go: (h: string) => void }) {
  const t = today();
  const bizs = d.businesses.filter((b) => !b.deleted_at);
  const states = bizs.map((b) => ({ b, l: latestLicence(d.licences, b.id) }));
  const live = states.filter(({ l }) => l && l.state === 'active');
  const trials = live.filter(({ l }) => l!.plan === 'trial').length;
  const expiring = live.filter(({ l }) => daysBetween(t, l!.effective_expiry_date) <= 14).sort((a, b) => a.l!.effective_expiry_date.localeCompare(b.l!.effective_expiry_date));
  const onHold = d.holds.filter((h) => !h.released_at && (!h.release_at || Date.parse(h.release_at) > Date.now())).length;
  const lapsed = states.filter(({ l }) => !l || l.state !== 'active').length;
  const payments = d.payments.filter((p) => !p.deleted_at);
  const paid = payments.filter((p) => p.status === 'paid');
  const refunded = payments.filter((p) => p.status === 'refunded').reduce((s, p) => s + Number(p.amount), 0);
  const revenue = paid.reduce((s, p) => s + Number(p.amount), 0) - refunded;

  const months: { key: string; label: string; total: number }[] = [];
  const base = new Date(); base.setUTCDate(1);
  for (let i = 5; i >= 0; i--) {
    const m = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() - i, 1));
    months.push({ key: m.toISOString().slice(0, 7), label: m.toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }), total: 0 });
  }
  payments.forEach((p) => { const m = months.find((x) => x.key === p.paid_on.slice(0, 7)); if (m) m.total += (p.status === 'paid' ? 1 : p.status === 'refunded' ? -1 : 0) * Number(p.amount); });
  const max = Math.max(1, ...months.map((m) => m.total));
  const owners = d.users.filter((u) => u.role === 'business_owner' && !u.deleted_at).length;

  return (
    <>
      <PageHead title="Overview" sub="Where every business stands today." />
      <div className="stats">
        <div className="stat"><span>Businesses</span><strong>{bizs.length}</strong><em>{owners} with an owner signed in</em></div>
        <div className="stat"><span>Live licences</span><strong>{live.length}</strong><em>{trials} on trial</em></div>
        <div className="stat"><span>Expiring in 14 days</span><strong>{expiring.length}</strong><em>{lapsed} already lapsed</em></div>
        <div className="stat"><span>On hold now</span><strong>{onHold}</strong><em>holds placed by you</em></div>
        <div className="stat"><span>Users</span><strong>{d.users.filter((u) => u.role !== 'super_admin' && !u.deleted_at).length}</strong><em>{d.invites.length} invited, not joined</em></div>
        <div className="stat"><span>Revenue</span><strong>{fmtMoney(revenue)}</strong><em>paid minus refunds</em></div>
      </div>
      <div className="grid2">
        <section className="panel">
          <header><h2>Needs attention</h2><span className="num">next 14 days</span></header>
          {expiring.length === 0 ? <Empty title="Nothing expiring soon" hint="Licences ending within 14 days appear here." /> : (
            <div className="tablewrap"><table><thead><tr><th>Business</th><th>Plan</th><th>Ends</th></tr></thead><tbody>
              {expiring.map(({ b, l }) => { const s = licenceBadge(l); return (
                <tr key={b.id} className="click" onClick={() => go(`business-${b.id}`)}>
                  <td>{b.name}</td><td><Badge tone={s.tone}>{s.label}</Badge></td>
                  <td className="num">{fmtDate(l!.effective_expiry_date)}<span className="sub">{s.days === 0 ? 'today' : `in ${s.days} days`}</span></td>
                </tr>); })}
            </tbody></table></div>
          )}
        </section>
        <section className="panel">
          <header><h2>Revenue, last 6 months</h2><span className="num">{fmtMoney(months.reduce((s, m) => s + m.total, 0))}</span></header>
          <div className="body">
            <div className="bars" role="img" aria-label={'Monthly revenue: ' + months.map((m) => `${m.label} ${fmtMoney(m.total)}`).join(', ')}>
              {months.map((m) => (
                <div key={m.key} className={'bar' + (m.total <= 0 ? ' empty' : '')} title={fmtMoney(m.total)}>
                  <i style={{ height: `${Math.max(2, (Math.max(0, m.total) / max) * 100)}%` }} /><span>{m.label}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
        <section className="panel" style={{ gridColumn: '1 / -1' }}>
          <header><h2>Recent payments</h2><button className="link" onClick={() => go('payments')}>All payments</button></header>
          {payments.length === 0 ? <Empty title="No payments yet" hint="They appear when a customer's app reports them through the API." /> : (
            <div className="tablewrap"><table><thead><tr><th>Business</th><th>Paid on</th><th>Status</th><th className="right">Amount</th></tr></thead><tbody>
              {payments.slice(0, 6).map((p) => (
                <tr key={p.id}><td>{nameOf(d, p.business_id)}</td><td className="num">{fmtDate(p.paid_on)}</td>
                  <td><Badge tone={p.status === 'paid' ? 'ok' : p.status === 'failed' ? 'bad' : 'warn'}>{p.status}</Badge></td>
                  <td className="right num">{fmtMoney(Number(p.amount))}</td></tr>
              ))}
            </tbody></table></div>
          )}
        </section>
      </div>
      <p className="num" style={{ color: 'var(--muted)', marginTop: 16 }}>Data as of {fmtDate(t)}. Trial default is 14 days (until {fmtDate(addDays(t, 14))} for a registration today).</p>
    </>
  );
}
