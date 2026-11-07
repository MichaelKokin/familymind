"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { chatCopy as c } from "@/i18n/chat";
import { safePublicChatUrl, type ChatResponse, type ChatCitation } from "@/private-case/chat-model";
import styles from "./FamilyChat.module.css";

export type FamilyChatProps = { mode: "private" | "demo"; onOpenSource?: (sourceId: string) => void; initialQuestion?: string };
export default function FamilyChat({ mode, onOpenSource, initialQuestion = "" }: FamilyChatProps) {
  const [state, setState] = useState<ChatResponse | null>(null), [question, setQuestion] = useState(initialQuestion), [searchWeb, setSearchWeb] = useState(false), [sending, setSending] = useState(false), [error, setError] = useState("");
  const [searchSubjectId, setSearchSubjectId] = useState("");
  const requestId = useRef(0);
  const active = state?.turns.find(t => t.status === "running");
  const activeId = active?.id;
  const selectedSubject = state?.capabilities.publicSearchSubjects.find(subject => subject.id === searchSubjectId) || state?.capabilities.publicSearchSubjects[0];
  const request = useCallback(async (method = "GET", body?: unknown) => {
    const id = ++requestId.current;
    const response = await fetch("/api/private/chat", { method, cache: "no-store", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const result = await response.json();
    if (!response.ok) { if ([401, 403].includes(response.status)) setState(null); throw new Error(c.errors[result.error] || c.errors.REQUEST_FAILED); }
    if (id === requestId.current) { setState(result); setError(""); }
    return result as ChatResponse;
  }, []);
  useEffect(() => {
    if (mode !== "private") return;
    let mounted = true;
    const load = () => request().catch(e => { if (mounted) setError(e.message); });
    void load(); const timer = setInterval(() => { void load(); }, activeId ? 1500 : 15000);
    return () => { mounted = false; clearInterval(timer); };
  }, [mode, request, activeId]);
  async function send(event: FormEvent) {
    event.preventDefault(); if (!state || !question.trim() || sending || active) return;
    setSending(true); setError("");
    const useSearch = searchWeb && state.capabilities.webSearch === "cached";
    try { await request("POST", { question: question.trim(), expectedRevision: state.revision, searchWeb: useSearch, ...(useSearch && selectedSubject ? { searchSubjectId: selectedSubject.id } : {}) }); setQuestion(""); }
    catch (e) { setError(e instanceof Error ? e.message : c.errors.REQUEST_FAILED); }
    finally { setSending(false); }
  }
  async function cancel() {
    if (!active) return;
    try { await request("DELETE", { turnId: active.id }); } catch (e) { setError(e instanceof Error ? e.message : c.errors.REQUEST_FAILED); }
  }
  function citation(item: ChatCitation) {
    if (item.scope === "research" && onOpenSource) return <button type="button" onClick={() => onOpenSource(item.sourceId)}>{item.title}</button>;
    if (safePublicChatUrl(item.url)) return <a href={item.url} target="_blank" rel="noopener noreferrer">{item.title}</a>;
    return <span>{item.title}</span>;
  }
  return <section className={styles.chat} aria-label={c.title}>
    <header><h2>{c.title}</h2><p>{c.subtitle}</p></header>
    {mode === "demo" ? <><p>{c.demo}</p><a href="/case">{c.openPrivate}</a></> : <>
      <p className={styles.muted}>{c.disclosure}</p>
      {error && <p role="alert" className={styles.error}>{error} <button type="button" onClick={() => { void request().catch(e => setError(e.message)); }}>{c.refresh}</button></p>}
      {!state && !error && <p role="status">{c.loading}</p>}
      {state?.turns.length === 0 && <p className={styles.empty}>{c.empty}</p>}
      <div className={styles.turns} aria-live="polite" aria-relevant="additions text">
        {state?.turns.map(turn => <article key={turn.id} className={styles.turn}>
          <p className={styles.question}>{turn.question}</p>
          {turn.status === "running" && <p role="status">{c.pending}</p>}
          {turn.status === "cancelled" && <p>{c.cancelled}</p>}
          {turn.status === "interrupted" && <p>{c.interrupted}</p>}
          {turn.status === "failed" && <p className={styles.error}>{c.errors[turn.error || ""] || c.failed}</p>}
          {turn.answer && <>
            {turn.answer.paragraphs.map((paragraph, i) => <div key={i} className={styles.paragraph}><p>{paragraph.text}</p>{paragraph.sourceIds.length ? <ul className={styles.citations}>{paragraph.sourceIds.map(id => { const item = turn.citations.find(s => s.id === id); return item ? <li key={id}>{citation(item)}</li> : null; })}</ul> : <small className={styles.muted}>{c.uncited}</small>}</div>)}
            {turn.answer.unknowns.length > 0 && <div><h3>{c.unknowns}</h3><ul>{turn.answer.unknowns.map((text, i) => <li key={i}>{text}</li>)}</ul></div>}
            {turn.answer.nextSteps.length > 0 && <div><h3>{c.nextSteps}</h3><ol>{turn.answer.nextSteps.map((text, i) => <li key={i}>{text}</li>)}</ol></div>}
            <small className={styles.muted}>{c.context}: {turn.context.peopleCount} {c.people}, {turn.context.sourceCount} {c.materials}; {turn.context.noteCount} {c.notes}.</small>
            {(turn.context.omittedHistoryTurns > 0 || turn.context.summarizedRuns > 0 || turn.context.deduplicatedSourceTexts > 0) && <p className={styles.muted}>{c.omittedHistory}: {turn.context.omittedHistoryTurns}; {c.summarizedRuns}: {turn.context.summarizedRuns}; {c.deduplicated}: {turn.context.deduplicatedSourceTexts}.</p>}
          </>}
          {turn.status !== "running" && <p className={styles.muted}>{turn.web.status === "performed" ? c.searchPerformed : turn.web.status === "failed" ? c.searchFailed : turn.web.status === "unavailable" ? c.searchUnavailable : c.searchNotRequested}</p>}
          {turn.web.status === "performed" && <details><summary>{c.leads}</summary>{turn.web.leads.length ? <ul>{turn.web.leads.map((lead, i) => <li key={i}>{safePublicChatUrl(lead.url) ? <a href={lead.url} target="_blank" rel="noopener noreferrer">{lead.title}</a> : lead.title}<p>{lead.detail}</p></li>)}</ul> : <p>{c.noLeads}</p>}{turn.web.limitation && <p>{turn.web.limitation}</p>}{turn.web.queries.length > 0 && <><h4>{c.queries}</h4><ul>{turn.web.queries.map((q, i) => <li key={i}>{q}</li>)}</ul></>}</details>}
        </article>)}
      </div>
      {state && <form onSubmit={send} className={styles.form}>
        <label htmlFor="family-chat-question">{c.question}</label>
        <textarea id="family-chat-question" value={question} maxLength={2000} rows={4} onChange={e => setQuestion(e.target.value)} placeholder={c.placeholder} disabled={sending || !!active} />
        {state.capabilities.webSearch === "cached" && <><label htmlFor="family-chat-subject">{c.searchSubject}</label><select id="family-chat-subject" value={selectedSubject?.id || ""} onChange={e => setSearchSubjectId(e.target.value)} disabled={sending || !!active}>{state.capabilities.publicSearchSubjects.map(subject => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select><label className={styles.search}><input type="checkbox" checked={searchWeb} onChange={e => setSearchWeb(e.target.checked)} disabled={sending || !!active} /><span>{c.searchPrefix} {selectedSubject?.name}<small>{c.searchDetail}</small></span></label></>}
        {state.capabilities.webSearch === "unavailable" && <p className={styles.muted}>{c.searchDisabledReason}</p>}
        <div className={styles.actions}><button type="submit" disabled={!question.trim() || sending || !!active}>{sending ? c.sending : c.send}</button>{active && <button type="button" onClick={() => { void cancel(); }}>{c.cancel}</button>}</div>
        <small className={styles.muted}>{c.limitedHistory}</small>
      </form>}
    </>}
  </section>;
}
