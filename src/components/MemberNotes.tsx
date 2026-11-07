"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { MemberAccount, MemberNote } from "@/private-case/member-model";
import { notesText as t } from "@/i18n/notes";
import styles from "./MemberNotes.module.css";

class NotesRequestError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); }
}
async function api<T>(route: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/private/${route}`, { method, cache: "no-store", credentials: "same-origin", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const result = await response.json();
  if (!response.ok) throw new NotesRequestError(result.error || "REQUEST_FAILED", response.status);
  return result as T;
}
function errorText(error: unknown) {
  if (error instanceof NotesRequestError) return t.errors[error.code as keyof typeof t.errors] || t.errors.generic;
  return t.errors.generic;
}

export default function MemberNotes({ personId }: { personId?: string }) {
  const [account, setAccount] = useState<MemberAccount | null>(null);
  const [notes, setNotes] = useState<MemberNote[]>([]);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [text, setText] = useState(""), [visibility, setVisibility] = useState<"private" | "family">("private");
  const [selectedPerson, setSelectedPerson] = useState(personId || ""), [editing, setEditing] = useState<MemberNote | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null), [inviteName, setInviteName] = useState("");
  const [invitation, setInvitation] = useState<{ url: string; expiresAt: string } | null>(null);
  const bootstrap = useRef<Promise<void> | null>(null), requestEpoch = useRef(0), busyRef = useRef(false);
  const failure = useCallback((reason: unknown) => {
    setError(errorText(reason));
    if (reason instanceof NotesRequestError && reason.status === 401) {
      setAccount(null); setNotes([]); setText(""); setEditing(null); setInvitation(null);
    }
  }, []);
  const reload = useCallback(async () => {
    const epoch = ++requestEpoch.current;
    const nextAccount = await api<MemberAccount>("members");
    const response = await api<{ notes: MemberNote[]; memberId: string; caseId: string }>(`notes${personId ? `?personId=${encodeURIComponent(personId)}` : ""}`);
    if (epoch !== requestEpoch.current) return;
    if (nextAccount.principal.memberId !== response.memberId || nextAccount.principal.caseId !== response.caseId) throw new NotesRequestError("UNAUTHORIZED", 401);
    setAccount(nextAccount); setNotes(response.notes); setError("");
    setSelectedPerson(old => personId || old || nextAccount.people[0]?.id || "");
  }, [personId]);
  useEffect(() => {
    let active = true;
    if (!bootstrap.current) {
      const token = personId ? null : new URLSearchParams(window.location.hash.slice(1)).get("memberToken");
      if (token) window.history.replaceState(null, "", window.location.pathname);
      bootstrap.current = token ? api("members", "POST", { action: "exchange", token }).then(() => undefined) : Promise.resolve();
    }
    void bootstrap.current.then(() => { if (active) return reload(); }).catch(reason => { if (active) failure(reason); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; requestEpoch.current += 1; };
  }, [reload, personId, failure]);
  async function action(work: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setMessage("");
    try { await work(); } catch (reason) { failure(reason); } finally { busyRef.current = false; setBusy(false); }
  }
  function resetEditor() { setEditing(null); setText(""); setVisibility("private"); }
  async function save(event: FormEvent) {
    event.preventDefault();
    await action(async () => {
      await api("notes", editing ? "PATCH" : "POST", editing ? { id: editing.id, expectedRevision: editing.revision, text, visibility } : { personId: selectedPerson, text, visibility });
      resetEditor(); await reload(); setMessage(t.saved);
    });
  }
  async function logout() {
    await action(async () => {
      await api(account?.principal.role === "owner" ? "logout" : "members", "POST", account?.principal.role === "owner" ? {} : { action: "logout" });
      requestEpoch.current += 1; setAccount(null); setNotes([]); resetEditor(); setInvitation(null); setMessage(t.signedOut);
    });
  }
  if (loading) return <section className={styles.root}><p role="status">{t.loading}</p></section>;
  if (!account) return <section className={styles.root}><h2>{personId ? t.title : t.cabinet}</h2><p>{t.locked}</p>{error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status">{message}</p>}<div className={styles.actions}><button onClick={() => void action(reload)} disabled={busy}>{t.retry}</button><button onClick={() => void logout()} disabled={busy}>{t.clearSession}</button></div></section>;
  const currentPerson = account.people.find(p => p.id === selectedPerson);
  return <section className={styles.root} data-testid="member-notes">
    <header className={styles.heading}><div><h2>{personId ? t.title : t.cabinet}</h2><p>{t.identity} <strong>{account.member.displayName}</strong> · {t.role[account.principal.role]}</p></div><button onClick={() => void action(reload)} disabled={busy}>{t.retry}</button></header>
    {!personId && <><p>{t.intro}</p><p className={styles.hint}>{t.boundary}</p><div className={styles.actions}><button onClick={() => void action(async () => { const bundle = await api<unknown>("notes?export=1"); const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = "family-mind-notes.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setMessage(t.exported); })} disabled={busy}>{t.export}</button><button onClick={() => void logout()} disabled={busy}>{t.logout}</button></div><p className={styles.hint}>{t.exportHint}</p></>}
    <p className={styles.hint}>{t.scope}</p>
    {error && <p className={styles.error} role="alert">{error}</p>}{message && <p className={styles.message} role="status">{message}</p>}
    <form onSubmit={save} className={styles.form}><fieldset disabled={busy}>
      {!personId && <label>{t.person}<select value={selectedPerson} disabled={Boolean(editing)} onChange={event => setSelectedPerson(event.target.value)}>{account.people.map(p => <option key={p.id} value={p.id}>{p.name}{account.people.filter(other => other.name === p.name).length > 1 ? ` · ${p.id.slice(-6)}` : ""}</option>)}</select></label>}
      {currentPerson ? <><label>{t.text}<textarea required minLength={1} maxLength={10000} rows={4} value={text} onChange={event => setText(event.target.value)} /></label><label>{t.visibility}<select value={visibility} onChange={event => setVisibility(event.target.value as "private" | "family")}><option value="private">{t.private}</option><option value="family">{t.family}</option></select></label><p className={styles.hint}>{t.sharingHint}</p><div className={styles.actions}><button className={styles.primary} type="submit">{busy ? t.saving : t.submit}</button>{editing && <button type="button" onClick={resetEditor}>{t.cancel}</button>}</div></> : <p>{t.unknownPerson}</p>}
    </fieldset></form>
    <div className={styles.notes}>{notes.length === 0 && <p>{t.empty}</p>}{[...notes].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).map(note => <article className={styles.note} key={note.id} data-testid={`note-${note.id}`}>
      <div className={styles.noteHead}><strong>{account.people.find(p => p.id === note.personId)?.name || t.unknownPerson}</strong><span className={note.visibility === "private" ? styles.private : styles.family}>{note.visibility === "private" ? t.notePrivate : t.noteFamily}</span></div><p className={styles.noteText}>{note.text}</p><small>{t.author}: {account.members.find(m => m.id === note.authorId)?.displayName || t.formerMember} · {t.updated}: {new Date(note.updatedAt).toLocaleString("ru-RU")}</small>
      {note.authorId === account.principal.memberId && <div className={styles.actions}><button disabled={busy} onClick={() => { setEditing(note); setSelectedPerson(note.personId); setText(note.text); setVisibility(note.visibility); setError(""); }}>{t.edit}</button><button disabled={busy} onClick={() => setDeleting(note.id)}>{t.remove}</button></div>}
      {deleting === note.id && <div className={styles.confirm}><span>{t.confirmDelete}</span><button disabled={busy} onClick={() => void action(async () => { await api("notes", "DELETE", { id: note.id, expectedRevision: note.revision }); if (editing?.id === note.id) resetEditor(); setDeleting(null); await reload(); setMessage(t.deleted); })}>{t.deleteConfirm}</button><button onClick={() => setDeleting(null)} disabled={busy}>{t.cancel}</button></div>}
    </article>)}</div>
    {!personId && account.principal.role === "owner" && <section className={styles.members}><h3>{t.members}</h3><p className={styles.hint}>{t.inviteHint}</p><p className={styles.hint}>{t.reinviteHint}</p><form onSubmit={event => { event.preventDefault(); void action(async () => { const result = await api<{ token: string; expiresAt: string }>("members", "POST", { action: "invite", displayName: inviteName }); setInvitation({ url: `${location.origin}/case/members#memberToken=${encodeURIComponent(result.token)}`, expiresAt: result.expiresAt }); setInviteName(""); await reload(); }); }}><fieldset disabled={busy}><label>{t.inviteName}<input required maxLength={120} value={inviteName} onChange={event => setInviteName(event.target.value)} /></label><button type="submit">{t.invite}</button></fieldset></form>{invitation && <div className={styles.invitation}><label>{t.inviteLink}<input readOnly value={invitation.url} /></label><small>{t.expires} {new Date(invitation.expiresAt).toLocaleTimeString("ru-RU")}</small><button onClick={() => void action(async () => { await navigator.clipboard.writeText(invitation.url); setMessage(t.copied); })}>{t.copy}</button></div>}{account.members.map(member => <div className={styles.member} key={member.id}><span>{member.displayName} · {member.active ? t.active : t.revoked}</span>{member.role !== "owner" && member.active && <div className={styles.actions}><button disabled={busy} onClick={() => void action(async () => { const result = await api<{ token: string; expiresAt: string }>("members", "POST", { action: "reinvite", memberId: member.id }); setInvitation({ url: `${location.origin}/case/members#memberToken=${encodeURIComponent(result.token)}`, expiresAt: result.expiresAt }); })}>{t.reinvite}</button><button disabled={busy} onClick={() => void action(async () => { await api("members", "POST", { action: "revoke", memberId: member.id }); await reload(); setMessage(t.revokeDone); })}>{t.revoke}</button></div>}</div>)}</section>}
    {!personId && <p className={styles.hint}>{t.privacy}</p>}
  </section>;
}
