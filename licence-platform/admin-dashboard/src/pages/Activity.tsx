import { useState } from 'react';
import { Badge, Empty, PageHead, Status } from '../ui';
import { Data, nameOf, userName } from './data';
import { TimelineRow, Tone, cmd, fmtDateTime, useLoad } from '../lib';

const OUTCOME: Record<string, Tone> = { succeeded: 'ok', failed: 'bad', blocked: 'warn', denied: 'bad', info: 'info' };

function pretty(what: string) {
  return what.replace('.', ' · ').replace(/_/g, ' ');
}

export function Timeline({ d, businessId, admin, limit = 100 }: { d: Data; businessId: string | null; admin: boolean; limit?: number }) {
  const { data, error, loading, reload } = useLoad(() => cmd<TimelineRow[]>('cmd_timeline', { p_business_id: businessId, p_limit: limit }), [businessId, limit]);
  if (error || (loading && !data)) return <Status loading={loading && !data} error={error} onRetry={reload} />;
  if (!data || data.length === 0) return <Empty title="No activity yet" hint="Changes, registrations and attempts show up here." />;
  return (
    <div className="tablewrap"><table><thead><tr><th>When (IST)</th><th>What</th><th>Who</th><th>Why</th>{admin && <th>Source</th>}</tr></thead><tbody>
      {data.map((r, i) => (
        <tr key={i}>
          <td className="num">{fmtDateTime(r.at)}</td>
          <td><strong>{pretty(r.what)}</strong>
            {r.kind === 'event' && r.outcome && <> <Badge tone={OUTCOME[r.outcome] ?? 'muted'}>{r.outcome}</Badge></>}
            {r.changed_columns && r.changed_columns.length > 0 && <span className="sub">{r.changed_columns.filter((c) => c !== 'updated_at').join(', ')}</span>}
            {admin && !businessId && r.business_id && <span className="sub">{nameOf(d, r.business_id)}</span>}
          </td>
          <td>{r.actor_id ? userName(d, r.actor_id) : <span className="sub">{r.source ?? 'system'}</span>}</td>
          <td>{r.reason ?? <span className="sub">-</span>}</td>
          {admin && <td className="num">{r.source ?? '-'}{r.ip && <span className="sub">{r.ip}</span>}</td>}
        </tr>
      ))}
    </tbody></table></div>
  );
}

export function ActivityPage({ d, admin, myBusinessId }: { d: Data; admin: boolean; myBusinessId: string | null }) {
  const [biz, setBiz] = useState('all');
  const businessId = admin ? (biz === 'all' ? null : biz) : myBusinessId;
  return (
    <>
      <PageHead title="Activity" sub={admin ? 'Every change, registration and attempt, newest first. Nothing here can be edited or removed.' : 'Changes made in your business, newest first.'} />
      <section className="panel">
        {admin && <div className="toolbar"><select id="aBiz" aria-label="Business" value={biz} onChange={(e) => setBiz(e.target.value)}><option value="all">All businesses</option>{d.businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>}
        <Timeline d={d} businessId={businessId} admin={admin} limit={200} />
      </section>
    </>
  );
}
