"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import Modal from "../Modal";
import type { SpaceAction } from "@/private-case/space-logic";
import { SPACE_EXPORT_FORMAT, type FindNovelty, type LivingStatus, type MaterialInput, type MaterialKind, type ParentRole, type RelationKind, type SpaceFind, type SpaceLead, type SpaceMaterial, type SpacePerson, type SpaceRelationship } from "@/private-case/space-model";
import type { SpaceComposition } from "@/private-case/space-layout";
import { spaceText as s } from "@/i18n/space";
import styles from "@/app/case/explore/space.module.css";
import { readMaterialFile, SpaceRequestError, spaceErrorText, template, type FindDecision, type MaterialFile, type NewPersonIs } from "./space-client";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function DialogFrame({ title, busy, error, onClose, children, testId }: { title: string; busy: boolean; error: string; onClose: () => void; children: ReactNode; testId?: string }) {
  return (
    <Modal title={title} onClose={onClose} busy={busy}>
      <div className={styles.root} data-testid={testId}>
        <div className={styles.dialogHeader}>
          <h2>{title}</h2>
          <button type="button" onClick={onClose} aria-label={s.close} disabled={busy}>×</button>
        </div>
        {error && <p role="alert" className={styles.errorText}>{error}</p>}
        {children}
      </div>
    </Modal>
  );
}

function sortedPeople(composition: SpaceComposition) {
  return [...composition.people].sort((a, b) => Number(b.id === composition.rootPersonId) - Number(a.id === composition.rootPersonId) || a.name.localeCompare(b.name, "ru"));
}

function PeopleChecklist({ composition, selected, onToggle, testId }: { composition: SpaceComposition; selected: string[]; onToggle: (id: string) => void; testId: string }) {
  return (
    <div className={styles.checkList} data-testid={testId}>
      {sortedPeople(composition).map((person) => (
        <label key={person.id}><input type="checkbox" checked={selected.includes(person.id)} onChange={() => onToggle(person.id)} /> {person.name}{person.dateText ? ` · ${person.dateText}` : ""}</label>
      ))}
    </div>
  );
}

function Actions({ busy, onClose, submitLabel = s.save }: { busy: boolean; onClose: () => void; submitLabel?: string }) {
  return (
    <div className={styles.formActions}>
      <button type="submit" className={styles.primary} disabled={busy}>{submitLabel}</button>
      <button type="button" className={styles.secondary} onClick={onClose} disabled={busy}>{s.cancel}</button>
    </div>
  );
}

type SubmitAction = (action: SpaceAction) => Promise<boolean>;

export function PersonDialog({ composition, anchorId, newPersonIs, edit, busy, error, onSubmit, onClose }: { composition: SpaceComposition; anchorId: string | null; newPersonIs: NewPersonIs | null; edit: SpacePerson | null; busy: boolean; error: string; onSubmit: SubmitAction; onClose: () => void }) {
  const [name, setName] = useState(edit?.name ?? "");
  const [dateText, setDateText] = useState(edit?.dateText ?? "");
  const [livingStatus, setLivingStatus] = useState<LivingStatus>(edit?.livingStatus ?? "unknown");
  const [notes, setNotes] = useState(edit?.notes ?? "");
  const [anchor, setAnchor] = useState(anchorId ?? composition.rootPersonId ?? "");
  const [role, setRole] = useState<NewPersonIs>(newPersonIs ?? "parent");
  const [parentRole, setParentRole] = useState<ParentRole>("parent");
  const [label, setLabel] = useState("");
  const [rationale, setRationale] = useState("");
  const [asOwner, setAsOwner] = useState(!composition.rootPersonId && !edit);
  const people = sortedPeople(composition);
  const anchorPerson = people.find((person) => person.id === anchor);
  const namesake = Boolean(name.trim()) && composition.people.some((person) => person.id !== edit?.id && person.name.trim().toLocaleLowerCase("ru") === name.trim().toLocaleLowerCase("ru"));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const person = { name: name.trim(), dateText: dateText.trim(), livingStatus, notes: notes.trim() };
    if (edit) { await onSubmit({ action: "update_person", id: edit.id, person }); return; }
    const relation = anchor && !asOwner ? { anchorPersonId: anchor, newPersonIs: role, ...(role === "parent" || role === "child" ? { parentRole } : {}), label: label.trim(), rationale: rationale.trim() } : undefined;
    await onSubmit({ action: "add_person", person, asOwner, ...(relation ? { relation } : {}) });
  };
  return (
    <DialogFrame title={edit ? s.personEditTitle : s.personFormTitle} busy={busy} error={error} onClose={onClose}>
      <form className={styles.form} onSubmit={submit} data-testid="person-form">
        <fieldset disabled={busy} className={styles.form}>
          <Field label={s.personName}><input name="name" required maxLength={300} autoFocus value={name} onChange={(event) => setName(event.target.value)} /></Field>
          {namesake && <p className={styles.notice}>{s.namesakeHint}</p>}
          <div className={styles.formGrid}>
            <Field label={s.personDate}><input name="dateText" maxLength={1000} value={dateText} onChange={(event) => setDateText(event.target.value)} /></Field>
            <Field label={s.personStatus}>
              <select name="livingStatus" value={livingStatus} onChange={(event) => setLivingStatus(event.target.value as LivingStatus)}>
                {(Object.keys(s.living) as LivingStatus[]).map((key) => <option key={key} value={key}>{s.living[key]}</option>)}
              </select>
            </Field>
          </div>
          <Field label={s.personNotes}><textarea name="notes" maxLength={20000} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
          {!edit && !composition.rootPersonId && <label className={styles.checkRow}><input type="checkbox" checked={asOwner} onChange={(event) => setAsOwner(event.target.checked)} /> {s.asOwner}</label>}
          {!edit && !asOwner && people.length > 0 && (
            <>
              <div className={styles.eyebrow}>{s.relationSection}</div>
              <Field label={s.relationTo}>
                <select name="anchor" value={anchor} onChange={(event) => setAnchor(event.target.value)}>
                  <option value="">{s.noRelation}</option>
                  {people.map((person) => <option key={person.id} value={person.id}>{person.name}{person.dateText ? ` · ${person.dateText}` : ""}</option>)}
                </select>
              </Field>
              {anchor && (
                <>
                  <Field label={s.newPersonIs}>
                    <select name="newPersonIs" value={role} onChange={(event) => setRole(event.target.value as NewPersonIs)}>
                      {(Object.keys(s.newPersonIsOptions) as NewPersonIs[]).map((key) => <option key={key} value={key}>{s.newPersonIsOptions[key]}</option>)}
                    </select>
                  </Field>
                  {(role === "parent" || role === "child") && (
                    <Field label={role === "parent" ? s.parentRole : s.anchorParentRole} hint={role === "child" && anchorPerson ? `${anchorPerson.name} → ${name.trim() || "…"}` : undefined}>
                      <select name="parentRole" value={parentRole} onChange={(event) => setParentRole(event.target.value as ParentRole)}>
                        {(Object.keys(s.parentRoles) as ParentRole[]).map((key) => <option key={key} value={key}>{s.parentRoles[key]}</option>)}
                      </select>
                    </Field>
                  )}
                  {role === "other" && <Field label={s.relationLabel}><input name="label" required maxLength={300} value={label} onChange={(event) => setLabel(event.target.value)} /></Field>}
                  <Field label={s.relationRationale}><input name="rationale" maxLength={5000} value={rationale} onChange={(event) => setRationale(event.target.value)} /></Field>
                  <p className={styles.hint}>{s.relationHint}</p>
                </>
              )}
            </>
          )}
          <Actions busy={busy} onClose={onClose} />
        </fieldset>
      </form>
    </DialogFrame>
  );
}

export type MaterialDraft = { material: MaterialInput; file?: MaterialFile };

export function MaterialDialog({ composition, personIds, edit, preset, busy, error, onCreate, onUpdate, onClose }: { composition: SpaceComposition; personIds: string[]; edit: SpaceMaterial | null; preset: MaterialKind | null; busy: boolean; error: string; onCreate: (draft: MaterialDraft) => Promise<boolean>; onUpdate: SubmitAction; onClose: () => void }) {
  const [kind, setKind] = useState<MaterialKind>(edit?.kind ?? preset ?? "photo");
  const [title, setTitle] = useState(edit?.title ?? "");
  const [text, setText] = useState(edit?.text ?? "");
  const [url, setUrl] = useState(edit?.url ?? "");
  const [provenance, setProvenance] = useState(edit?.provenance ?? "");
  const [dateText, setDateText] = useState(edit?.dateText ?? "");
  const [selected, setSelected] = useState<string[]>(edit?.personIds ?? personIds);
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState("");
  const withFile = kind === "photo" || kind === "document";
  const toggle = (id: string) => setSelected((previous) => (previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLocalError("");
    const material: MaterialInput = { kind, title: title.trim(), text: text.trim(), url: kind === "link" ? url.trim() : "", provenance: provenance.trim(), dateText: dateText.trim(), personIds: selected };
    if (edit) {
      const { kind: _kind, ...patch } = material;
      void _kind;
      await onUpdate({ action: "update_material", id: edit.id, material: patch });
      return;
    }
    try {
      await onCreate({ material, ...(withFile && file ? { file: await readMaterialFile(file) } : {}) });
    } catch (failure) {
      setLocalError(failure instanceof SpaceRequestError ? spaceErrorText(failure) : s.errors.REQUEST_FAILED);
    }
  };
  return (
    <DialogFrame title={edit ? s.materialEditTitle : s.materialFormTitle} busy={busy} error={error || localError} onClose={onClose}>
      <form className={styles.form} onSubmit={submit} data-testid="material-form">
        <fieldset disabled={busy} className={styles.form}>
          <div className={styles.formGrid}>
            <Field label={s.materialKind}>
              <select name="kind" value={kind} disabled={Boolean(edit)} onChange={(event) => setKind(event.target.value as MaterialKind)}>
                {(Object.keys(s.materialKinds) as MaterialKind[]).map((key) => <option key={key} value={key}>{s.materialKinds[key]}</option>)}
              </select>
            </Field>
            <Field label={s.materialDate}><input name="dateText" maxLength={1000} value={dateText} onChange={(event) => setDateText(event.target.value)} /></Field>
          </div>
          <Field label={s.materialTitle}><input name="title" required maxLength={300} autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
          {withFile && !edit && <Field label={s.materialFile} hint={s.materialFileHint}><input name="file" type="file" accept={kind === "photo" ? "image/png,image/jpeg,image/webp" : "image/png,image/jpeg,image/webp,application/pdf,text/plain,.txt"} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></Field>}
          {withFile && !edit && !file && <p className={styles.hint}>{s.materialNoFile}</p>}
          {kind === "link" && <Field label={s.materialUrl}><input name="url" type="url" required maxLength={3000} value={url} onChange={(event) => setUrl(event.target.value)} /></Field>}
          <Field label={s.materialText}><textarea name="text" required={kind === "note"} maxLength={20000} rows={kind === "note" ? 5 : 3} value={text} onChange={(event) => setText(event.target.value)} /></Field>
          <Field label={s.materialProvenance}><input name="provenance" maxLength={5000} value={provenance} onChange={(event) => setProvenance(event.target.value)} /></Field>
          <div className={styles.field}>
            <span>{s.materialPeople}</span>
            <PeopleChecklist composition={composition} selected={selected} onToggle={toggle} testId="material-people" />
            {!selected.length && <small>{s.materialNoPeople}</small>}
          </div>
          <Actions busy={busy} onClose={onClose} />
        </fieldset>
      </form>
    </DialogFrame>
  );
}

export function AttachOriginalDialog({ material, busy, error, onAttach, onClose }: { material: SpaceMaterial; busy: boolean; error: string; onAttach: (file: MaterialFile) => Promise<boolean>; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [localError, setLocalError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!file) return;
    setLocalError("");
    try { await onAttach(await readMaterialFile(file)); } catch (failure) { setLocalError(failure instanceof SpaceRequestError ? spaceErrorText(failure) : s.errors.REQUEST_FAILED); }
  };
  return (
    <DialogFrame title={s.attachTitle} busy={busy} error={error || localError} onClose={onClose}>
      <form className={styles.form} onSubmit={submit} data-testid="attach-form">
        <fieldset disabled={busy} className={styles.form}>
          <p className={styles.hint}>{material.title} · {s.attachHint}</p>
          <Field label={s.materialFile} hint={s.materialFileHint}><input name="file" type="file" required accept={material.kind === "photo" ? "image/png,image/jpeg,image/webp" : "image/png,image/jpeg,image/webp,application/pdf,text/plain,.txt"} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></Field>
          <Actions busy={busy} onClose={onClose} submitLabel={s.attachOriginal} />
        </fieldset>
      </form>
    </DialogFrame>
  );
}

export function RelationshipDialog({ composition, edit, fromId, busy, error, onSubmit, onClose }: { composition: SpaceComposition; edit: SpaceRelationship | null; fromId: string | null; busy: boolean; error: string; onSubmit: SubmitAction; onClose: () => void }) {
  const people = sortedPeople(composition);
  const [from, setFrom] = useState(edit?.from ?? fromId ?? composition.rootPersonId ?? people[0]?.id ?? "");
  const [to, setTo] = useState(edit?.to ?? people.find((person) => person.id !== (fromId ?? composition.rootPersonId))?.id ?? "");
  const [kind, setKind] = useState<RelationKind>(edit?.kind ?? "parent_child");
  const [parentRole, setParentRole] = useState<ParentRole>(edit?.parentRole ?? "parent");
  const [label, setLabel] = useState(edit?.label ?? "");
  const [rationale, setRationale] = useState(edit?.rationale ?? "");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const relation = { kind, ...(kind === "parent_child" ? { parentRole } : {}), label: label.trim(), rationale: rationale.trim() };
    if (edit) await onSubmit({ action: "update_relationship", id: edit.id, relation });
    else await onSubmit({ action: "add_relationship", from, to, relation });
  };
  const name = (id: string) => composition.people.find((person) => person.id === id)?.name ?? "";
  return (
    <DialogFrame title={edit ? s.editRelation : s.relationshipFormTitle} busy={busy} error={error} onClose={onClose}>
      <form className={styles.form} onSubmit={submit} data-testid="relationship-form">
        <fieldset disabled={busy} className={styles.form}>
          {edit ? <p className={styles.hint}>{name(edit.from)} → {name(edit.to)}</p> : (
            <div className={styles.formGrid}>
              <Field label={s.relationFrom}><select name="from" value={from} onChange={(event) => setFrom(event.target.value)}>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>
              <Field label={s.relationTo2}><select name="to" value={to} onChange={(event) => setTo(event.target.value)}>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></Field>
            </div>
          )}
          <Field label={s.relationKind} hint={kind === "parent_child" ? s.relationDirectionHint : undefined}>
            <select name="kind" value={kind} onChange={(event) => setKind(event.target.value as RelationKind)}>
              {(Object.keys(s.relationKinds) as RelationKind[]).map((key) => <option key={key} value={key}>{s.relationKinds[key]}</option>)}
            </select>
          </Field>
          {kind === "parent_child" && <Field label={s.parentRole}><select name="parentRole" value={parentRole} onChange={(event) => setParentRole(event.target.value as ParentRole)}>{(Object.keys(s.parentRoles) as ParentRole[]).map((key) => <option key={key} value={key}>{s.parentRoles[key]}</option>)}</select></Field>}
          <Field label={s.relationLabel}><input name="label" required={kind === "other"} maxLength={300} value={label} onChange={(event) => setLabel(event.target.value)} /></Field>
          <Field label={s.relationRationale}><input name="rationale" maxLength={5000} value={rationale} onChange={(event) => setRationale(event.target.value)} /></Field>
          <p className={styles.hint}>{s.relationHint}</p>
          <Actions busy={busy} onClose={onClose} />
        </fieldset>
      </form>
    </DialogFrame>
  );
}

export function LeadDialog({ composition, personId, edit, initialQuestion, busy, error, onSubmit, onClose }: { composition: SpaceComposition; personId: string | null; edit: SpaceLead | null; initialQuestion: string; busy: boolean; error: string; onSubmit: SubmitAction; onClose: () => void }) {
  const people = sortedPeople(composition);
  const name = (id: string) => composition.people.find((person) => person.id === id)?.name ?? "";
  const defaultQuestion = (id: string) => (id ? template(s.leadDefaultQuestion, { name: name(id) }) : "");
  const [person, setPerson] = useState(edit?.personId ?? personId ?? "");
  const [question, setQuestion] = useState(edit?.question ?? (initialQuestion || defaultQuestion(personId ?? "")));
  const [touched, setTouched] = useState(Boolean(edit) || Boolean(initialQuestion));
  const [placeText, setPlaceText] = useState(edit?.placeText ?? "");
  const [periodText, setPeriodText] = useState(edit?.periodText ?? "");
  const [reopen, setReopen] = useState(edit?.status === "needs_detail" || edit?.status === "nothing_found");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (edit) await onSubmit({ action: "update_lead", id: edit.id, lead: { question: question.trim(), placeText: placeText.trim(), periodText: periodText.trim() }, ...(reopen ? { status: "open" } : {}) });
    else await onSubmit({ action: "add_lead", lead: { personId: person || null, question: question.trim(), placeText: placeText.trim(), periodText: periodText.trim() } });
  };
  return (
    <DialogFrame title={s.leadFormTitle} busy={busy} error={error} onClose={onClose}>
      <form className={styles.form} onSubmit={submit} data-testid="lead-form">
        <fieldset disabled={busy} className={styles.form}>
          <p className={styles.notice}>{s.leadManualHint}</p>
          {!edit && (
            <Field label={s.leadPerson}>
              <select name="personId" value={person} onChange={(event) => { setPerson(event.target.value); if (!touched) setQuestion(defaultQuestion(event.target.value)); }}>
                <option value="">{s.leadNoPerson}</option>
                {people.map((item) => <option key={item.id} value={item.id}>{item.name}{item.dateText ? ` · ${item.dateText}` : ""}</option>)}
              </select>
            </Field>
          )}
          <Field label={s.leadQuestion}><textarea name="question" required maxLength={300} rows={2} autoFocus value={question} onChange={(event) => { setTouched(true); setQuestion(event.target.value); }} /></Field>
          <div className={styles.formGrid}>
            <Field label={s.leadPlace}><input name="placeText" maxLength={1000} value={placeText} onChange={(event) => setPlaceText(event.target.value)} /></Field>
            <Field label={s.leadPeriod}><input name="periodText" maxLength={1000} value={periodText} onChange={(event) => setPeriodText(event.target.value)} /></Field>
          </div>
          {edit && (edit.status === "needs_detail" || edit.status === "nothing_found" || edit.status === "cancelled") && <label className={styles.checkRow}><input type="checkbox" checked={reopen} onChange={(event) => setReopen(event.target.checked)} /> {s.leadReopen}</label>}
          <Actions busy={busy} onClose={onClose} />
        </fieldset>
      </form>
    </DialogFrame>
  );
}

export function FindDialog({ composition, leadId, personIds, busy, error, onSubmit, onClose }: { composition: SpaceComposition; leadId: string | null; personIds: string[]; busy: boolean; error: string; onSubmit: SubmitAction; onClose: () => void }) {
  const openLeads = composition.leads.filter((lead) => lead.status !== "cancelled" && lead.status !== "done");
  const [lead, setLead] = useState(leadId ?? "");
  const [title, setTitle] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [url, setUrl] = useState("");
  const [locator, setLocator] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [kind, setKind] = useState("");
  const [dateText, setDateText] = useState("");
  const [why, setWhy] = useState("");
  const [novelty, setNovelty] = useState<FindNovelty>("new");
  const [selected, setSelected] = useState<string[]>(personIds);
  const [localError, setLocalError] = useState("");
  const toggle = (id: string) => setSelected((previous) => (previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim() && !locator.trim() && !excerpt.trim()) { setLocalError(s.findSourceRequired); return; }
    setLocalError("");
    await onSubmit({ action: "add_find", find: { leadId: lead || null, personIds: selected, title: title.trim(), source: { title: sourceTitle.trim(), url: url.trim(), locator: locator.trim(), excerpt: excerpt.trim(), kind: kind.trim(), dateText: dateText.trim() }, why: why.trim(), novelty } });
  };
  return (
    <DialogFrame title={s.findFormTitle} busy={busy} error={error || localError} onClose={onClose}>
      <form className={styles.form} onSubmit={submit} data-testid="find-form">
        <fieldset disabled={busy} className={styles.form}>
          <p className={styles.notice}>{s.findManualHint}</p>
          {!leadId && openLeads.length > 0 && (
            <Field label={s.leadQuestion}>
              <select name="leadId" value={lead} onChange={(event) => setLead(event.target.value)}>
                <option value="">—</option>
                {openLeads.map((item) => <option key={item.id} value={item.id}>{item.question}</option>)}
              </select>
            </Field>
          )}
          <Field label={s.findTitleField}><input name="title" required maxLength={300} autoFocus value={title} onChange={(event) => setTitle(event.target.value)} /></Field>
          <div className={styles.formGrid}>
            <Field label={s.findSourceTitle}><input name="sourceTitle" required maxLength={300} value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} /></Field>
            <Field label={s.findSourceKind}><input name="kind" maxLength={1000} value={kind} onChange={(event) => setKind(event.target.value)} /></Field>
          </div>
          <Field label={s.findSourceUrl}><input name="url" type="url" maxLength={3000} value={url} onChange={(event) => setUrl(event.target.value)} /></Field>
          <div className={styles.formGrid}>
            <Field label={s.findSourceLocator}><input name="locator" maxLength={1000} value={locator} onChange={(event) => setLocator(event.target.value)} /></Field>
            <Field label={s.findSourceDate}><input name="dateText" maxLength={1000} value={dateText} onChange={(event) => setDateText(event.target.value)} /></Field>
          </div>
          <Field label={s.findSourceExcerpt}><textarea name="excerpt" maxLength={20000} rows={3} value={excerpt} onChange={(event) => setExcerpt(event.target.value)} /></Field>
          <Field label={s.findWhyField}><textarea name="why" required maxLength={5000} rows={3} value={why} onChange={(event) => setWhy(event.target.value)} /></Field>
          <div className={styles.field}>
            <span>{s.findNoveltyField}</span>
            <div className={styles.segmented}>
              {(Object.keys(s.findNovelty) as FindNovelty[]).map((key) => <label key={key}><input type="radio" name="novelty" value={key} checked={novelty === key} onChange={() => setNovelty(key)} />{s.findNovelty[key]}</label>)}
            </div>
          </div>
          <div className={styles.field}>
            <span>{s.findPeople}</span>
            <PeopleChecklist composition={composition} selected={selected} onToggle={toggle} testId="find-people" />
          </div>
          <Actions busy={busy} onClose={onClose} />
        </fieldset>
      </form>
    </DialogFrame>
  );
}

export function DecideFindDialog({ composition, find, decision, busy, error, onSubmit, onClose }: { composition: SpaceComposition; find: SpaceFind; decision: FindDecision; busy: boolean; error: string; onSubmit: SubmitAction; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [nextQuestion, setNextQuestion] = useState("");
  const [selected, setSelected] = useState<string[]>(find.personIds);
  const toggle = (id: string) => setSelected((previous) => (previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onSubmit({ action: "decide_find", id: find.id, decision, reason: reason.trim(), nextQuestion: nextQuestion.trim(), ...(decision === "accepted" ? { personIds: selected } : {}) });
  };
  return (
    <DialogFrame title={s.decideTitle[decision]} busy={busy} error={error} onClose={onClose} testId="decide-dialog">
      <form className={styles.form} onSubmit={submit} data-testid="decide-form">
        <fieldset disabled={busy} className={styles.form}>
          <p className={styles.hint}>{find.title}</p>
          <p className={styles.notice}>{s.decideHint[decision]}</p>
          <Field label={s.decideReason}><textarea name="reason" required maxLength={5000} rows={3} autoFocus value={reason} onChange={(event) => setReason(event.target.value)} /></Field>
          {decision === "accepted" && <div className={styles.field}><span>{s.decidePlaceNextTo}</span><PeopleChecklist composition={composition} selected={selected} onToggle={toggle} testId="decide-people" /></div>}
          <Field label={s.decideNextQuestion}><input name="nextQuestion" maxLength={1000} value={nextQuestion} onChange={(event) => setNextQuestion(event.target.value)} /></Field>
          <p className={styles.hint}>{s.findStatusNote}</p>
          <Actions busy={busy} onClose={onClose} submitLabel={decision === "accepted" ? s.findAccept : decision === "contested" ? s.findContest : s.findReject} />
        </fieldset>
      </form>
    </DialogFrame>
  );
}

export function LeadOutcomeDialog({ lead, outcome, busy, error, onSubmit, onClose }: { lead: SpaceLead; outcome: "nothing_found" | "needs_detail"; busy: boolean; error: string; onSubmit: SubmitAction; onClose: () => void }) {
  const [coverage, setCoverage] = useState(lead.coverage);
  const [missingDetail, setMissingDetail] = useState(lead.missingDetail);
  const [nextQuestion, setNextQuestion] = useState(lead.nextQuestion);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    await onSubmit({ action: "update_lead", id: lead.id, lead: outcome === "nothing_found" ? { coverage: coverage.trim(), missingDetail: missingDetail.trim(), nextQuestion: nextQuestion.trim() } : { missingDetail: missingDetail.trim() }, status: outcome });
  };
  return (
    <DialogFrame title={outcome === "nothing_found" ? s.nothingFoundTitle : s.needsDetailTitle} busy={busy} error={error} onClose={onClose}>
      <form className={styles.form} onSubmit={submit} data-testid="lead-outcome-form">
        <fieldset disabled={busy} className={styles.form}>
          <p className={styles.hint}>{lead.question}</p>
          <p className={styles.notice}>{outcome === "nothing_found" ? s.nothingFoundHint : s.needsDetailHint}</p>
          {outcome === "nothing_found" && <Field label={s.leadCoverage}><textarea name="coverage" required maxLength={20000} rows={3} autoFocus value={coverage} onChange={(event) => setCoverage(event.target.value)} /></Field>}
          <Field label={s.leadMissingDetail}><input name="missingDetail" required={outcome === "needs_detail"} maxLength={1000} value={missingDetail} onChange={(event) => setMissingDetail(event.target.value)} /></Field>
          {outcome === "nothing_found" && <Field label={s.leadNextQuestion}><input name="nextQuestion" maxLength={1000} value={nextQuestion} onChange={(event) => setNextQuestion(event.target.value)} /></Field>}
          <Actions busy={busy} onClose={onClose} />
        </fieldset>
      </form>
    </DialogFrame>
  );
}

export function ImportDialog({ caseId, busy, error, onImport, onClose }: { caseId: string; busy: boolean; error: string; onImport: (bundle: unknown) => Promise<boolean>; onClose: () => void }) {
  const [staged, setStaged] = useState<{ bundle: unknown; people: number; materials: number; files: number } | null>(null);
  const [localError, setLocalError] = useState("");
  const check = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError("");
    setStaged(null);
    try {
      const file = new FormData(event.currentTarget).get("bundle");
      if (!(file instanceof File) || file.size > 64 * 1024 * 1024) throw new SpaceRequestError("REQUEST_TOO_LARGE");
      let input: unknown;
      try { input = JSON.parse(await file.text()); } catch { throw new SpaceRequestError("INVALID_IMPORT"); }
      const bundle = input as { format?: unknown; caseId?: unknown; space?: { people?: unknown[]; materials?: unknown[] }; files?: unknown[] };
      if (!bundle || typeof bundle !== "object" || bundle.format !== SPACE_EXPORT_FORMAT) throw new SpaceRequestError("INVALID_IMPORT");
      if (bundle.caseId !== caseId) throw new SpaceRequestError("CASE_SCOPE_VIOLATION");
      setStaged({ bundle: input, people: bundle.space?.people?.length ?? 0, materials: bundle.space?.materials?.length ?? 0, files: bundle.files?.length ?? 0 });
    } catch (failure) {
      setLocalError(spaceErrorText(failure));
    }
  };
  return (
    <DialogFrame title={s.importTitle} busy={busy} error={error || localError} onClose={onClose}>
      <p className={styles.hint}>{s.importHint}</p>
      <form className={styles.form} onSubmit={check}>
        <Field label={s.importFile}><input type="file" name="bundle" accept="application/json,.json" required disabled={busy} onChange={() => setStaged(null)} /></Field>
        <div className={styles.formActions}><button type="submit" className={styles.secondary} disabled={busy}>{s.checkImport}</button></div>
      </form>
      {staged && (
        <div className={styles.notice} data-testid="import-preview">
          <p>{s.importReady}</p>
          <p>{staged.people} · {staged.materials} · {staged.files} — {s.importCount}</p>
          <div className={styles.formActions}><button type="button" className={styles.primary} disabled={busy} onClick={() => { void onImport(staged.bundle); }}>{s.importConfirm}</button></div>
        </div>
      )}
    </DialogFrame>
  );
}
