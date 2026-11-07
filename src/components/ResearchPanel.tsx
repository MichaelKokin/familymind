"use client";

import { useRef, useState, type FormEvent } from "react";
import {
  newId,
  type ResearchQuestion,
  type ResearchRun,
  type Workspace,
} from "../domain/model";
import { researchText as t } from "../i18n/research";

export interface ResearchPanelProps {
  workspace: Workspace;
  selectedId: string | null;
  onChange: (workspace: Workspace) => Promise<boolean>;
  onSelect: (id: string) => void;
  onOpenSource: (id: string) => void;
}

function blankQuestion(): ResearchQuestion {
  return {
    id: newId("question"),
    personId: null,
    question: "",
    known: "",
    place: "",
    period: "",
    plan: "",
    status: "open",
    sourceIds: [],
    outcome: "",
    limitations: "",
    archivistDraft: "",
    synthetic: true,
  };
}

function putQuestion(
  workspace: Workspace,
  question: ResearchQuestion,
): Workspace {
  const exists = workspace.questions.some((item) => item.id === question.id);
  return {
    ...workspace,
    questions: exists
      ? workspace.questions.map((item) =>
          item.id === question.id ? question : item,
        )
      : [...workspace.questions, question],
    positions: workspace.positions[question.id]
      ? workspace.positions
      : {
          ...workspace.positions,
          [question.id]: { x: 600, y: 100 + workspace.questions.length * 180 },
        },
  };
}

function makeDraft(workspace: Workspace, question: ResearchQuestion): string {
  const person = workspace.people.find((item) => item.id === question.personId);
  const sources = workspace.sources.filter((source) =>
    question.sourceIds.includes(source.id),
  );
  const section = (label: string, value: string) =>
    `${label}:\n${value.trim() || t.missing}`;
  return [
    t.draftTitle,
    section(
      t.draftPerson,
      person
        ? `${person.name}${person.variants.length ? ` (${person.variants.join("; ")})` : ""}`
        : t.noPerson,
    ),
    section(t.draftQuestion, question.question),
    section(t.draftKnown, question.known),
    section(t.draftPlace, question.place),
    section(t.draftPeriod, question.period),
    section(t.draftPlan, question.plan),
    section(
      t.draftSources,
      sources.length
        ? sources
            .map(
              (source, index) =>
                `${index + 1}. ${source.title}\n${source.citation}${source.url ? `\n${source.url}` : ""}`,
            )
            .join("\n\n")
        : t.none,
    ),
    section(t.draftOutcome, question.outcome),
    section(t.draftLimits, question.limitations),
    t.draftRequest,
    t.draftBoundary,
  ].join("\n\n");
}

function downloadDraft(question: ResearchQuestion) {
  const url = URL.createObjectURL(
    new Blob([question.archivistDraft], { type: "text/plain;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "family-mind-archivist-draft.txt";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ResearchPanel(props: ResearchPanelProps) {
  const { workspace, selectedId, onSelect } = props;
  const [creating, setCreating] = useState(false);
  const selected = workspace.questions.find(
    (question) => question.id === selectedId,
  );
  return (
    <section className="stack research-panel" aria-label={t.title}>
      <div>
        <span className="badge">{t.mode}</span>
        <h2 className="section-title">{t.title}</h2>
        <p className="muted">{t.introduction}</p>
      </div>
      <div className="stack" aria-label={t.questions}>
        {workspace.questions.length === 0 && (
          <p className="empty-state">{t.noQuestions}</p>
        )}
        {workspace.questions.map((question) => (
          <button
            type="button"
            className="record"
            key={question.id}
            aria-pressed={!creating && selectedId === question.id}
            onClick={() => {
              setCreating(false);
              onSelect(question.id);
            }}
          >
            <strong>{question.question}</strong>
            <span className="badge">{t.states[question.status]}</span>
          </button>
        ))}
        <button
          type="button"
          className="button secondary"
          onClick={() => setCreating(true)}
        >
          {t.newQuestion}
        </button>
      </div>
      {creating ? (
        <QuestionEditor
          {...props}
          key="new-question"
          question={null}
          onSaved={(id) => {
            setCreating(false);
            onSelect(id);
          }}
          onCancel={() => setCreating(false)}
        />
      ) : selected ? (
        <QuestionEditor
          {...props}
          key={selected.id}
          question={selected}
          onSaved={onSelect}
        />
      ) : (
        <p className="muted">{t.selectQuestion}</p>
      )}
    </section>
  );
}

interface EditorProps extends ResearchPanelProps {
  question: ResearchQuestion | null;
  onSaved: (id: string) => void;
  onCancel?: () => void;
}

function QuestionEditor({
  workspace,
  question,
  onChange,
  onSaved,
  onCancel,
  onOpenSource,
}: EditorProps) {
  const [draft, setDraft] = useState<ResearchQuestion>(
    () => question ?? blankQuestion(),
  );
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [findingSource, setFindingSource] = useState("");
  const [findingLocator, setFindingLocator] = useState("");
  const [findingNotes, setFindingNotes] = useState("");
  const [checkAction, setCheckAction] = useState("");
  const [checkCoverage, setCheckCoverage] = useState("");
  const [checkOutcome, setCheckOutcome] =
    useState<ResearchRun["outcome"]>("pending");
  const [checkNotes, setCheckNotes] = useState("");
  const [checkSource, setCheckSource] = useState("");
  const current = workspace.questions.find((item) => item.id === draft.id);
  const linkedIds = current?.sourceIds ?? draft.sourceIds;
  const linkedSources = workspace.sources.filter((source) =>
    linkedIds.includes(source.id),
  );
  const runs = workspace.runs.filter((run) => run.questionId === draft.id);
  const update = <K extends keyof ResearchQuestion>(
    key: K,
    value: ResearchQuestion[K],
  ) => {
    setDraft((old) => ({ ...old, [key]: value }));
    setMessage("");
  };
  const persist = async (next: Workspace): Promise<boolean> => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    setMessage("");
    try {
      const saved = await onChange(next);
      if (!saved) setMessage(t.saveFailed);
      return saved;
    } catch {
      setMessage(t.saveFailed);
      return false;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = {
      ...draft,
      question: draft.question.trim(),
      sourceIds: linkedIds,
    };
    if (!(await persist(putQuestion(workspace, next)))) return;
    setDraft(next);
    setMessage(t.saved);
    onSaved(next.id);
  };
  const attachFinding = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!current || !findingSource) return;
    if (linkedIds.includes(findingSource)) {
      setMessage(t.duplicateSource);
      return;
    }
    const next = { ...current, sourceIds: [...linkedIds, findingSource] };
    const run: ResearchRun = {
      id: newId("run"),
      questionId: current.id,
      mode: "manual",
      action: t.attachmentAction,
      coverage: findingLocator.trim(),
      outcome: "found",
      notes: findingNotes.trim(),
      sourceIds: [findingSource],
      createdAt: new Date().toISOString(),
    };
    if (
      !(await persist({
        ...putQuestion(workspace, next),
        runs: [...workspace.runs, run],
      }))
    )
      return;
    setDraft((old) => ({ ...old, sourceIds: next.sourceIds }));
    setFindingSource("");
    setFindingLocator("");
    setFindingNotes("");
    setMessage(t.attachmentSaved);
  };
  const recordCheck = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!current) return;
    const run: ResearchRun = {
      id: newId("run"),
      questionId: current.id,
      mode: "manual",
      action: checkAction.trim(),
      coverage: checkCoverage.trim(),
      outcome: checkOutcome,
      notes: checkNotes.trim(),
      sourceIds: checkSource ? [checkSource] : [],
      createdAt: new Date().toISOString(),
    };
    const nextQuestion =
      checkOutcome === "found" && checkSource
        ? {
            ...current,
            sourceIds: [...new Set([...current.sourceIds, checkSource])],
          }
        : current;
    if (
      !(await persist({
        ...putQuestion(workspace, nextQuestion),
        runs: [...workspace.runs, run],
      }))
    )
      return;
    setDraft((old) => ({ ...old, sourceIds: nextQuestion.sourceIds }));
    setCheckAction("");
    setCheckCoverage("");
    setCheckNotes("");
    setCheckSource("");
    setCheckOutcome("pending");
    setMessage(t.checkSaved);
  };
  const generateDraft = () => {
    const text = makeDraft(workspace, { ...draft, sourceIds: linkedIds });
    if (text.length > 20000) {
      setMessage(t.draftTooLong);
      return;
    }
    update("archivistDraft", text);
  };
  return (
    <fieldset
      className="stack inspector-fieldset"
      disabled={pending}
      aria-busy={pending}
    >
      <form className="stack" onSubmit={save}>
        <h3 className="section-title">
          {question ? t.editQuestion : t.newQuestion}
        </h3>
        <label className="field">
          {t.question}
          <input
            required
            maxLength={300}
            value={draft.question}
            placeholder={t.questionPlaceholder}
            onChange={(event) => update("question", event.target.value)}
          />
        </label>
        <label className="field">
          {t.person}
          <select
            value={draft.personId ?? ""}
            onChange={(event) => update("personId", event.target.value || null)}
          >
            <option value="">{t.noPerson}</option>
            {workspace.people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name} · {person.dateText || t.missing} ·{" "}
                {person.id.slice(-6)}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {t.known}
          <textarea
            maxLength={20000}
            rows={3}
            value={draft.known}
            onChange={(event) => update("known", event.target.value)}
          />
        </label>
        <label className="field">
          {t.place}
          <input
            maxLength={1000}
            value={draft.place}
            onChange={(event) => update("place", event.target.value)}
          />
        </label>
        <label className="field">
          {t.period}
          <input
            maxLength={1000}
            value={draft.period}
            onChange={(event) => update("period", event.target.value)}
          />
        </label>
        <label className="field">
          {t.plan}
          <textarea
            maxLength={20000}
            rows={4}
            value={draft.plan}
            onChange={(event) => update("plan", event.target.value)}
          />
        </label>
        <label className="field">
          {t.status}
          <select
            value={draft.status}
            onChange={(event) =>
              update("status", event.target.value as ResearchQuestion["status"])
            }
          >
            {(Object.keys(t.states) as ResearchQuestion["status"][]).map(
              (status) => (
                <option key={status} value={status}>
                  {t.states[status]}
                </option>
              ),
            )}
          </select>
        </label>
        <label className="field">
          {t.outcome}
          <textarea
            maxLength={20000}
            rows={3}
            required={draft.status === "resolved"}
            value={draft.outcome}
            onChange={(event) => update("outcome", event.target.value)}
          />
        </label>
        <label className="field">
          {t.limitations}
          <textarea
            maxLength={20000}
            rows={3}
            required={draft.status === "resolved"}
            value={draft.limitations}
            onChange={(event) => update("limitations", event.target.value)}
          />
        </label>
        {draft.status === "resolved" && (
          <p className="notice">{t.resolvedHint}</p>
        )}
        <div className="stack">
          <h3 className="section-title">{t.draft}</h3>
          <p className="muted">{t.draftHint}</p>
          <button
            type="button"
            className="button secondary"
            disabled={!draft.question.trim()}
            onClick={generateDraft}
          >
            {t.generateDraft}
          </button>
          {draft.archivistDraft && (
            <>
              <label className="field">
                {t.draftLabel}
                <textarea
                  maxLength={20000}
                  rows={12}
                  value={draft.archivistDraft}
                  onChange={(event) =>
                    update("archivistDraft", event.target.value)
                  }
                />
              </label>
              <p className="muted">{t.draftSaveHint}</p>
              <button
                type="button"
                className="button secondary"
                onClick={() => downloadDraft(draft)}
              >
                {t.downloadDraft}
              </button>
            </>
          )}
        </div>
        <div className="actions">
          <button type="submit" className="button primary">
            {question ? t.save : t.createQuestion}
          </button>
          {onCancel && (
            <button
              type="button"
              className="button secondary"
              onClick={onCancel}
            >
              {t.cancel}
            </button>
          )}
        </div>
      </form>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {current && (
        <>
          <section className="stack" aria-label={t.linkedSources}>
            <h3 className="section-title">{t.linkedSources}</h3>
            {linkedSources.length ? (
              linkedSources.map((source) => (
                <div className="record stack" key={source.id}>
                  <strong>{source.title}</strong>
                  <span className="muted">{source.citation}</span>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => onOpenSource(source.id)}
                  >
                    {t.openSource}
                  </button>
                </div>
              ))
            ) : (
              <p className="muted">{t.noLinkedSources}</p>
            )}
            <p className="muted">{t.sourceHint}</p>
            {workspace.sources.length ? (
              <form className="stack" onSubmit={attachFinding}>
                <label className="field">
                  {t.selectSource}
                  <select
                    required
                    value={findingSource}
                    onChange={(event) => setFindingSource(event.target.value)}
                  >
                    <option value="">{t.chooseSource}</option>
                    {workspace.sources
                      .filter((source) => !linkedIds.includes(source.id))
                      .map((source) => (
                        <option key={source.id} value={source.id}>
                          {source.title}
                        </option>
                      ))}
                  </select>
                </label>
                {findingSource && (
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => onOpenSource(findingSource)}
                  >
                    {t.openSource}
                  </button>
                )}
                <label className="field">
                  {t.attachmentCoverage}
                  <input
                    required
                    maxLength={20000}
                    value={findingLocator}
                    onChange={(event) => setFindingLocator(event.target.value)}
                  />
                </label>
                <label className="field">
                  {t.attachmentNotes}
                  <textarea
                    required
                    maxLength={20000}
                    rows={3}
                    value={findingNotes}
                    onChange={(event) => setFindingNotes(event.target.value)}
                  />
                </label>
                <button type="submit" className="button secondary">
                  {t.attachSource}
                </button>
              </form>
            ) : (
              <p className="empty-state">{t.noSources}</p>
            )}
          </section>
          <section className="stack" aria-label={t.manualCheck}>
            <h3 className="section-title">{t.manualCheck}</h3>
            <p className="muted">{t.checkHint}</p>
            <form className="stack" onSubmit={recordCheck}>
              <label className="field">
                {t.checkAction}
                <input
                  required
                  maxLength={300}
                  value={checkAction}
                  onChange={(event) => setCheckAction(event.target.value)}
                />
              </label>
              <label className="field">
                {t.checkCoverage}
                <textarea
                  required
                  maxLength={20000}
                  rows={2}
                  value={checkCoverage}
                  onChange={(event) => setCheckCoverage(event.target.value)}
                />
              </label>
              <label className="field">
                {t.checkResult}
                <select
                  value={checkOutcome}
                  onChange={(event) =>
                    setCheckOutcome(
                      event.target.value as ResearchRun["outcome"],
                    )
                  }
                >
                  {(Object.keys(t.results) as ResearchRun["outcome"][]).map(
                    (outcome) => (
                      <option key={outcome} value={outcome}>
                        {t.results[outcome]}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label className="field">
                {t.checkNotes}
                <textarea
                  required
                  maxLength={20000}
                  rows={3}
                  value={checkNotes}
                  onChange={(event) => setCheckNotes(event.target.value)}
                />
              </label>
              <label className="field">
                {t.checkSource}
                <select
                  required={checkOutcome === "found"}
                  value={checkSource}
                  onChange={(event) => setCheckSource(event.target.value)}
                >
                  <option value="">{t.noCheckSource}</option>
                  {workspace.sources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.title}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="button secondary">
                {t.recordCheck}
              </button>
            </form>
          </section>
          <section className="stack" aria-label={t.history}>
            <h3 className="section-title">{t.history}</h3>
            {runs.length ? (
              [...runs].reverse().map((run) => (
                <article key={run.id} className="record stack">
                  <span className="badge">
                    {run.mode === "manual" ? t.manual : t.demo}
                  </span>
                  <strong>{run.action}</strong>
                  <time dateTime={run.createdAt}>
                    {new Date(run.createdAt).toLocaleString("ru-RU")}
                  </time>
                  <p>{run.coverage}</p>
                  <span className="badge">{t.results[run.outcome]}</span>
                  <p>{run.notes}</p>
                  {run.sourceIds.map((id) => (
                    <button
                      type="button"
                      className="button secondary"
                      key={id}
                      onClick={() => onOpenSource(id)}
                    >
                      {workspace.sources.find((source) => source.id === id)
                        ?.title ?? t.openSource}
                    </button>
                  ))}
                </article>
              ))
            ) : (
              <p className="muted">{t.noHistory}</p>
            )}
          </section>
        </>
      )}
    </fieldset>
  );
}

export default ResearchPanel;
