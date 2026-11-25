import { useState } from 'react';
import { BUSINESS_TYPES, Business, HOLD_REASONS, HoldTarget, addDays, cmd, errText, normalisePhone, supabase, today } from '../lib';
import { Field, Form, Modal, toast } from '../ui';

export function AddBusinessModal({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const [f, setF] = useState({ name: '', ownerName: '', ownerEmail: '', ownerPhone: '' });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  return (
    <Modal title="Add business" onClose={onClose}>
      <Form submitLabel="Add business" onCancel={onClose} onSubmit={async () => {
        const email = f.ownerEmail.trim().toLowerCase();
        if (!f.name.trim()) throw new Error('Enter a business name.');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter the owner\'s Google email.');
        const phone = f.ownerPhone.trim() ? normalisePhone(f.ownerPhone) : null;
        if (f.ownerPhone.trim() && !phone) throw new Error('Enter a valid phone number, for example 9840011223.');
        const r = await cmd<{ business_id: string; owner_added?: boolean }>('cmd_create_business', { p_name: f.name.trim(), p_owner_email: email, p_owner_name: f.ownerName.trim() || null, p_owner_phone: phone });
        toast(r.owner_added ? 'Business added. The owner already has a login and can see it now.' : 'Business added. The owner joins by signing in with Google.'); onDone(r.business_id);
      }}>
        <Field label="Business name"><input id="bizName" value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus /></Field>
        <Field label="Owner name"><input id="bizOwnerName" value={f.ownerName} onChange={(e) => set('ownerName', e.target.value)} /></Field>
        <Field label="Owner Google email (can be someone who already uses another business)"><input id="bizOwnerEmail" type="email" value={f.ownerEmail} onChange={(e) => set('ownerEmail', e.target.value)} /></Field>
        <Field label="Owner phone (optional)"><input id="bizOwnerPhone" type="tel" value={f.ownerPhone} onChange={(e) => set('ownerPhone', e.target.value)} /></Field>
      </Form>
    </Modal>
  );
}

export function EnrolModal({ businessId, isAdmin, onClose, onDone }: { businessId: string; isAdmin: boolean; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: '', email: '', phone: '', role: 'user' });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  return (
    <Modal title="Enrol a user" onClose={onClose}>
      <Form submitLabel="Enrol user" onCancel={onClose} onSubmit={async () => {
        const email = f.email.trim().toLowerCase();
        if (!f.name.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Enter a name and a valid Google email.');
        const body: Record<string, string> = { name: f.name.trim(), email, phone: f.phone.trim(), business_id: businessId };
        if (isAdmin) body.role = f.role;
        const { data, error } = await supabase.functions.invoke('enrol-user', { body });
        if (error) throw new Error(await errText(error));
        toast(data?.member_added ? `${email} already has a login and was added to this business.` : `Invited ${email}. They join by signing in with Google.`); onDone();
      }}>
        <Field label="Name"><input id="eName" value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus /></Field>
        <Field label="Google email"><input id="eEmail" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Phone (optional)"><input id="ePhone" type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
        {isAdmin && (
          <Field label="Role">
            <select id="eRole" value={f.role} onChange={(e) => set('role', e.target.value)}>
              <option value="user">User</option><option value="business_owner">Business owner</option>
            </select>
          </Field>
        )}
      </Form>
    </Modal>
  );
}

export function AddLicenceModal({ businessId, onClose, onDone }: { businessId: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ plan: 'paid', start: today(), expiry: addDays(today(), 365) });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  return (
    <Modal title="Add licence" onClose={onClose}>
      <Form submitLabel="Add licence" onCancel={onClose} onSubmit={async () => {
        if (f.expiry < f.start) throw new Error('Expiry date cannot be before the start date.');
        await cmd('cmd_create_licence', { p_business: businessId, p_plan: f.plan, p_start: f.start, p_expiry: f.expiry });
        toast('Licence added'); onDone();
      }}>
        <Field label="Plan"><select id="lPlan" value={f.plan} onChange={(e) => set('plan', e.target.value)}><option value="paid">Paid</option><option value="trial">Trial</option></select></Field>
        <Field label="Start date"><input id="lStart" type="date" value={f.start} onChange={(e) => set('start', e.target.value)} /></Field>
        <Field label="Expiry date"><input id="lExpiry" type="date" value={f.expiry} onChange={(e) => set('expiry', e.target.value)} /></Field>
        <p className="hint">Days a licence spends on hold are added back to its expiry automatically.</p>
      </Form>
    </Modal>
  );
}

export function EditBusinessModal({ business, onClose, onDone }: { business: Business; onClose: () => void; onDone: () => void }) {
  const b = business;
  const [f, setF] = useState({
    name: b.name, legal_name: b.legal_name ?? '', business_type: b.business_type ?? '', email: b.email ?? '', phone: b.phone ?? '',
    address_line: b.address_line ?? '', city: b.city ?? '', state: b.state ?? '', pincode: b.pincode ?? '', country: b.country || 'IN',
    website: b.website ?? '', gstin: b.gstin ?? '', registration_no: b.registration_no ?? '',
  });
  const set = (k: string, v: string) => setF((s) => ({ ...s, [k]: v }));
  const blank = (v: string) => (v.trim() === '' ? null : v.trim());
  return (
    <Modal title={`Business profile #${b.business_no}`} onClose={onClose} wide>
      <Form columns submitLabel="Save profile" onCancel={onClose} onSubmit={async () => {
        const country = f.country.trim().toUpperCase() || 'IN';
        const phone = f.phone.trim() ? normalisePhone(f.phone) : null;
        const gstin = f.gstin.trim().toUpperCase();
        if (!f.name.trim()) throw new Error('Business name is required.');
        if (f.phone.trim() && !phone) throw new Error('Enter a valid phone number, for example 9840011223 or +919840011223.');
        if (f.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email.trim())) throw new Error('Enter a valid business email.');
        if (!/^[A-Z]{2}$/.test(country)) throw new Error('Country must be a 2-letter code, for example IN.');
        if (f.pincode.trim() && country === 'IN' && !/^[0-9]{6}$/.test(f.pincode.trim())) throw new Error('An Indian pincode has 6 digits.');
        if (gstin && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) throw new Error('GSTIN should be 15 characters, for example 33ABCDE1234F1Z5. Leave it blank if you do not want to add it.');
        const patch = {
          name: f.name.trim(), legal_name: blank(f.legal_name), business_type: blank(f.business_type), email: blank(f.email.toLowerCase()), phone,
          address_line: blank(f.address_line), city: blank(f.city), state: blank(f.state), pincode: blank(f.pincode), country,
          website: blank(f.website), gstin: gstin || null, registration_no: blank(f.registration_no),
        };
        try { await cmd('cmd_update_business', { p_business_id: b.id, p_patch: patch }); }
        catch (e) { const m = (e as Error).message; throw new Error(m.includes('businesses_gstin') ? 'This GSTIN is already registered with another business.' : m); }
        toast('Profile saved'); onDone();
      }}>
        <Field label="Business name" full><input id="bName" value={f.name} onChange={(e) => set('name', e.target.value)} autoFocus /></Field>
        <Field label="Legal name (optional)"><input id="bLegal" value={f.legal_name} onChange={(e) => set('legal_name', e.target.value)} /></Field>
        <Field label="Business type (optional)">
          <select id="bType" value={f.business_type} onChange={(e) => set('business_type', e.target.value)}>
            <option value="">Not set</option>{BUSINESS_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
        <Field label="Business email"><input id="bEmail" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></Field>
        <Field label="Business phone"><input id="bPhone" type="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} placeholder="9840011223" /></Field>
        <Field label="Address (optional)" full><input id="bAddr" value={f.address_line} onChange={(e) => set('address_line', e.target.value)} /></Field>
        <Field label="City"><input id="bCity" value={f.city} onChange={(e) => set('city', e.target.value)} /></Field>
        <Field label="State"><input id="bState" value={f.state} onChange={(e) => set('state', e.target.value)} /></Field>
        <Field label="Pincode"><input id="bPin" inputMode="numeric" value={f.pincode} onChange={(e) => set('pincode', e.target.value)} /></Field>
        <Field label="Country code"><input id="bCountry" maxLength={2} value={f.country} onChange={(e) => set('country', e.target.value)} /></Field>
        <Field label="Website (optional)"><input id="bWeb" value={f.website} onChange={(e) => set('website', e.target.value)} /></Field>
        <Field label="Registration no. (optional)"><input id="bReg" value={f.registration_no} onChange={(e) => set('registration_no', e.target.value)} /></Field>
        <Field label="GSTIN (optional)" full><input id="bGstin" value={f.gstin} onChange={(e) => set('gstin', e.target.value)} placeholder="Leave blank if not needed" /></Field>
        <p className="hint" style={{ gridColumn: '1 / -1' }}>Only the business name is required here. Everything else is optional.</p>
      </Form>
    </Modal>
  );
}

export function ReasonModal({ title, confirm, hint, optional, onClose, onRun }: { title: string; confirm: string; hint?: string; optional?: boolean; onClose: () => void; onRun: (reason: string) => Promise<void> }) {
  const [r, setR] = useState('');
  return (
    <Modal title={title} onClose={onClose}>
      <Form submitLabel={confirm} onCancel={onClose} onSubmit={async () => {
        if (!optional && r.trim().length < 3) throw new Error('Give a short reason (at least 3 characters). It is kept in the audit trail.');
        await onRun(r.trim());
      }}>
        {hint && <p className="hint">{hint}</p>}
        <Field label={optional ? 'Note (optional)' : 'Reason'} full><input id="reason" value={r} onChange={(e) => setR(e.target.value)} autoFocus /></Field>
      </Form>
    </Modal>
  );
}

export interface HoldTargetInfo { type: HoldTarget; id: string; label: string; isOwner?: boolean }
export function HoldModal({ target, onClose, onDone }: { target: HoldTargetInfo; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ reason: 'policy', note: '', releaseAt: '' });
  const [rollover, setRollover] = useState<boolean | null>(null);
  const effRollover = rollover ?? f.reason !== 'non_payment';
  const effect = target.type === 'licence' ? 'The business is blocked until the hold is released.'
    : target.type === 'business' ? 'Everyone in this business is blocked until the hold is released.'
    : target.type === 'user' ? 'This person is blocked in EVERY business they belong to. If they own a business, that business is locked too.'
    : target.isOwner ? 'This is the business owner. Holding them locks this whole business. Their other businesses are not affected.' : 'Only this person in this business is blocked. Their other businesses are not affected.';
  return (
    <Modal title={`Put on hold: ${target.label}`} onClose={onClose}>
      <Form submitLabel="Place hold" onCancel={onClose} onSubmit={async () => {
        await cmd('cmd_place_hold', {
          p_target_type: target.type, p_target_id: target.id, p_reason_code: f.reason, p_note: f.note.trim() || null,
          p_release_at: f.releaseAt ? new Date(f.releaseAt).toISOString() : null, p_rollover: effRollover,
        });
        toast('Hold placed'); onDone();
      }}>
        <p className="hint">{effect}</p>
        <Field label="Reason"><select id="hReason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })}>{HOLD_REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
        <Field label={f.reason === 'other' ? 'Note (required)' : 'Note (optional)'} full><input id="hNote" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        <Field label="Auto-release at (optional, your device time)"><input id="hRelease" type="datetime-local" value={f.releaseAt} onChange={(e) => setF({ ...f, releaseAt: e.target.value })} /></Field>
        <label className="checkrow"><input id="hRoll" type="checkbox" checked={effRollover} onChange={(e) => setRollover(e.target.checked)} /> Add the held days back to the licence expiry</label>
      </Form>
    </Modal>
  );
}

type Ask = { title: string; confirm: string; hint?: string; optional?: boolean; ok: string; run: (reason: string) => Promise<unknown> };
/** One place for every "needs a reason" or "place a hold" action. Render `node` once on the page. */
export function useActions(reload: () => void) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [hold, setHold] = useState<HoldTargetInfo | null>(null);
  const node = (
    <>
      {ask && <ReasonModal title={ask.title} confirm={ask.confirm} hint={ask.hint} optional={ask.optional} onClose={() => setAsk(null)}
        onRun={async (r) => { await ask.run(r); toast(ask.ok); setAsk(null); reload(); }} />}
      {hold && <HoldModal target={hold} onClose={() => setHold(null)} onDone={() => { setHold(null); reload(); }} />}
    </>
  );
  const remove = (entity: string, id: string, what: string) => setAsk({ title: `Delete ${what}`, confirm: 'Delete', hint: 'Nothing is erased. It is hidden and can be restored later.', ok: `${what} deleted`, run: (r) => cmd('cmd_soft_delete', { p_entity: entity, p_id: id, p_reason: r }) });
  const restore = (entity: string, id: string, what: string) => setAsk({ title: `Restore ${what}`, confirm: 'Restore', ok: `${what} restored`, run: (r) => cmd('cmd_restore', { p_entity: entity, p_id: id, p_reason: r }) });
  const release = (holdId: string) => setAsk({ title: 'Release hold', confirm: 'Release', optional: true, ok: 'Hold released', run: (r) => cmd('cmd_release_hold', { p_hold: holdId, p_note: r || null }) });
  const removeMember = (id: string, name: string, biz: string) => setAsk({ title: `Remove ${name} from ${biz}`, confirm: 'Remove', hint: 'Only this business is affected. Their login and any other business stay as they are. Nothing is erased; it can be restored later.', ok: `${name} removed from ${biz}`, run: (r) => cmd('cmd_remove_member', { p_membership: id, p_reason: r }) });
  const setMemberStatus = (id: string, status: 'active' | 'inactive', name: string) => setAsk({ title: `${status === 'active' ? 'Activate' : 'Deactivate'} ${name} in this business`, confirm: status === 'active' ? 'Activate' : 'Deactivate', ok: status === 'active' ? 'Activated' : 'Deactivated', run: (r) => cmd('cmd_set_membership_status', { p_membership: id, p_status: status, p_reason: r }) });
  const setStatus = (userId: string, status: 'active' | 'inactive', name: string) => setAsk({ title: `${status === 'active' ? 'Activate' : 'Deactivate'} ${name} everywhere`, confirm: status === 'active' ? 'Activate' : 'Deactivate', hint: 'This applies to every business the person belongs to.', ok: status === 'active' ? 'Person activated' : 'Person deactivated', run: (r) => cmd('cmd_set_user_status', { p_user: userId, p_status: status, p_reason: r }) });
  const cancelInvite = (id: string, email: string) => setAsk({ title: `Cancel invite for ${email}`, confirm: 'Cancel invite', ok: 'Invite cancelled', run: (r) => cmd('cmd_cancel_invite', { p_invite: id, p_reason: r }) });
  const revoke = (id: string) => setAsk({ title: 'Revoke licence', confirm: 'Revoke', hint: 'A revoked licence cannot be reactivated. Add a new licence instead.', ok: 'Licence revoked', run: (r) => cmd('cmd_revoke_licence', { p_licence: id, p_reason: r }) });
  return { node, placeHold: setHold, remove, restore, release, setStatus, removeMember, setMemberStatus, cancelInvite, revoke };
}

