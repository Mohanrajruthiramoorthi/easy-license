import { FormEvent, ReactNode, useEffect, useState } from 'react';

export function Badge({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'muted' | 'info'; children: ReactNode }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}

export function Modal({ title, onClose, wide, children }: { title: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <header><h3>{title}</h3><button className="icon" onClick={onClose} aria-label="Close">&times;</button></header>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, full, children }: { label: string; full?: boolean; children: ReactNode }) {
  return <label className={'field' + (full ? ' full' : '')}><span>{label}</span>{children}</label>;
}

export function Form({ onSubmit, submitLabel, onCancel, columns, children }: { onSubmit: () => Promise<void>; submitLabel: string; onCancel: () => void; columns?: boolean; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('');
    try { await onSubmit(); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
  };
  return (
    <form onSubmit={go}>
      <div className={'fields' + (columns ? ' two' : '')}>{children}</div>
      {err && <p className="error" role="alert">{err}</p>}
      <div className="actions"><button type="button" className="btn ghost" onClick={onCancel}>Cancel</button><button className="btn" disabled={busy}>{busy ? 'Saving...' : submitLabel}</button></div>
    </form>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return <div className="empty"><strong>{title}</strong>{hint && <span>{hint}</span>}</div>;
}

export function PageHead({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return <div className="pagehead"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>{action}</div>;
}

export function Status({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
  if (error) return <div className="notice bad" role="alert">{error} <button className="link" onClick={onRetry}>Try again</button></div>;
  if (loading) return <div className="loading" aria-live="polite">Loading...</div>;
  return null;
}

let pushToast: (m: string) => void = () => {};
export const toast = (m: string) => pushToast(m);
export function Toaster() {
  const [msg, setMsg] = useState('');
  useEffect(() => { pushToast = (m) => { setMsg(m); window.setTimeout(() => setMsg(''), 3200); }; }, []);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}
