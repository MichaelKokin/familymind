"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  newId,
  type Workspace,
  type Person,
  type Source,
  type Claim,
  type RelationshipClaim,
  type EvidenceLink,
} from "@/domain/model";
import { readArtifactFile } from "@/data/files";
import { ru as t } from "@/i18n/ru";
import { editorText as et } from "@/i18n/editor";
export type EditorMode =
  "person" | "source" | "claim" | "relationship" | "evidence";
export type EditRequest = { mode: EditorMode; id?: string };
export const Field = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) => (
  <label className="field">
    <span>{label}</span>
    {children}
  </label>
);
const field = (d: FormData, k: string) => String(d.get(k) || "").trim();
export default function Editor({
  request,
  workspace,
  onSave,
  onClose,
  onError,
}: {
  request: EditRequest;
  workspace: Workspace;
  onSave: (w: Workspace, id: string) => Promise<boolean>;
  onClose: () => void;
  onError: (e: unknown) => void;
}) {
  const [busy, setBusy] = useState(false);
  const { mode, id } = request;
  const person = workspace.people.find((x) => x.id === id),
    source = workspace.sources.find((x) => x.id === id),
    claim = workspace.claims.find((x) => x.id === id);
  const sourceArtifacts = workspace.artifacts.filter((x) => x.sourceId === id);
  const [editingArtifactId, setEditingArtifactId] = useState(
    sourceArtifacts[0]?.id || "",
  );
  const artifact = sourceArtifacts.find((x) => x.id === editingArtifactId);
  const [transcription, setTranscription] = useState(
    artifact?.transcription || "",
  );
  const [exportAllowed, setExportAllowed] = useState(
    artifact?.exportAllowed ?? true,
  );
  const [uploadSelected, setUploadSelected] = useState(false);
  const [evidenceSourceId, setEvidenceSourceId] = useState("");
  const [evidenceArtifactId, setEvidenceArtifactId] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const dialog = dialogRef.current;
    if (dialog && !dialog.contains(document.activeElement))
      dialog
        .querySelector<HTMLElement>("input,select,textarea,button")
        ?.focus();
    const containFocus = (event: FocusEvent) => {
      if (
        dialog &&
        event.target instanceof Node &&
        !dialog.contains(event.target)
      )
        (
          dialog.querySelector<HTMLElement>(
            "input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled)",
          ) || dialog
        ).focus();
    };
    document.addEventListener("focusin", containFocus);
    return () => {
      document.removeEventListener("focusin", containFocus);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  function selectEditingArtifact(artifactId: string) {
    const selected = sourceArtifacts.find((a) => a.id === artifactId);
    setEditingArtifactId(artifactId);
    setTranscription(selected?.transcription || "");
    setExportAllowed(selected?.exportAllowed ?? true);
  }
  function clearUpload() {
    if (fileRef.current) fileRef.current.value = "";
    setUploadSelected(false);
    selectEditingArtifact(editingArtifactId);
  }
  const evidenceFields = (
    <>
      <Field label={t.chooseSource}>
        <select
          name="sourceId"
          required={mode === "evidence"}
          value={evidenceSourceId}
          onChange={(event) => {
            setEvidenceSourceId(event.target.value);
            setEvidenceArtifactId("");
          }}
        >
          <option value="">{t.noSource}</option>
          {workspace.sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>
      </Field>
      {evidenceSourceId && (
        <Field label={et.artifact}>
          <select
            name="artifactId"
            value={evidenceArtifactId}
            onChange={(event) => setEvidenceArtifactId(event.target.value)}
          >
            <option value="">{et.metadataOnly}</option>
            {workspace.artifacts
              .filter((a) => a.sourceId === evidenceSourceId)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.id.slice(-6)}
                </option>
              ))}
          </select>
          <small>{et.artifactHelp}</small>
        </Field>
      )}
      <Field label={t.polarity}>
        <select name="polarity">
          {Object.entries(t.polarities).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t.locator}>
        <input name="locator" />
      </Field>
      <Field label={t.excerpt}>
        <textarea name="excerpt" rows={3} />
      </Field>
      <Field label={t.group}>
        <input name="independenceGroup" />
        <small>{t.groupHelp}</small>
      </Field>
      <label className="check">
        <input type="checkbox" name="direct" />
        {t.direct}
      </label>
    </>
  );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const d = new FormData(e.currentTarget);
    setBusy(true);
    try {
      const w = structuredClone(workspace);
      let entityId = id || newId(mode);
      if (mode === "person") {
        const p: Person = {
          id: entityId,
          name: field(d, "name"),
          variants: field(d, "variants")
            .split(";")
            .map((v) => v.trim())
            .filter(Boolean),
          dateText: field(d, "dateText"),
          calendar: field(d, "calendar") as Person["calendar"],
          livingStatus: field(d, "livingStatus") as Person["livingStatus"],
          notes: field(d, "notes"),
          synthetic: true,
        };
        w.people = person
          ? w.people.map((x) => (x.id === id ? p : x))
          : [...w.people, p];
      } else if (mode === "source") {
        const s: Source = {
          id: entityId,
          title: field(d, "title"),
          citation: field(d, "citation"),
          url: field(d, "url"),
          originalId: field(d, "originalId") || newId("original"),
          notes: field(d, "notes"),
          synthetic: true,
        };
        w.sources = source
          ? w.sources.map((x) => (x.id === id ? s : x))
          : [...w.sources, s];
        const f = d.get("file");
        if (f instanceof File && f.name) {
          const file = await readArtifactFile(f);
          w.artifacts.push({
            id: newId("artifact"),
            sourceId: entityId,
            ...file,
            transcription: field(d, "transcription"),
            exportAllowed: d.has("exportAllowed"),
            synthetic: true,
          });
        } else if (artifact)
          w.artifacts = w.artifacts.map((a) =>
            a.id === artifact.id
              ? {
                  ...a,
                  transcription: field(d, "transcription"),
                  exportAllowed: d.has("exportAllowed"),
                }
              : a,
          );
      } else if (mode === "claim") {
        const c: Claim = {
          id: entityId,
          personId: field(d, "personId"),
          predicate: field(d, "predicate"),
          value: field(d, "value"),
          rationale: field(d, "rationale"),
          evidenceStatus: claim?.evidenceStatus || "hypothesis",
          workflowStatus: claim?.workflowStatus || "proposed",
          alternativesReviewed: claim?.alternativesReviewed || false,
          synthetic: true,
        };
        w.claims = claim
          ? w.claims.map((x) => (x.id === id ? c : x))
          : [...w.claims, c];
      } else if (mode === "relationship") {
        const r: RelationshipClaim = {
          id: entityId,
          fromPersonId: field(d, "from"),
          toPersonId: field(d, "to"),
          kind: field(d, "kind") as RelationshipClaim["kind"],
          rationale: field(d, "rationale"),
          evidenceStatus: "hypothesis",
          workflowStatus: "proposed",
          alternativesReviewed: false,
          synthetic: true,
        };
        w.relationships.push(r);
      }
      if (mode === "evidence" || mode === "claim" || mode === "relationship") {
        const sourceId = field(d, "sourceId");
        if (sourceId) {
          const s = w.sources.find((x) => x.id === sourceId)!;
          const link: EvidenceLink = {
            id: newId("evidence"),
            targetId: entityId,
            sourceId,
            artifactId: field(d, "artifactId") || null,
            polarity: field(d, "polarity") as EvidenceLink["polarity"],
            locator: field(d, "locator"),
            excerpt: field(d, "excerpt"),
            independenceGroup: field(d, "independenceGroup") || s.originalId,
            rationale: field(d, "rationale"),
            direct: d.has("direct"),
          };
          w.evidence.push(link);
        }
        if (mode === "evidence") entityId = id!;
      }
      if (!w.positions[entityId])
        w.positions[entityId] = {
          x: 80 + ((w.people.length + w.sources.length) % 4) * 280,
          y: 100 + Math.floor((w.people.length + w.sources.length) / 4) * 230,
        };
      await onSave(w, entityId);
    } catch (error) {
      onError(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            if (!busy) onClose();
          }
          if (e.key === "Tab") {
            const controls = Array.from(
              e.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])',
              ),
            ).filter(
              (element) =>
                !element.hidden &&
                element.getAttribute("aria-hidden") !== "true",
            );
            const first = controls[0],
              last = controls.at(-1);
            if (!first) {
              e.preventDefault();
              return;
            }
            if (
              e.shiftKey &&
              (document.activeElement === first ||
                !e.currentTarget.contains(document.activeElement))
            ) {
              e.preventDefault();
              last?.focus();
            } else if (
              !e.shiftKey &&
              (document.activeElement === last ||
                !e.currentTarget.contains(document.activeElement))
            ) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <div className="panel-heading">
          <div>
            <p className="eyebrow">{t.synthetic}</p>
            <h2 id="editor-title">
              {mode === "evidence"
                ? t.addEvidence
                : id
                  ? t.edit
                  : {
                      person: t.addPerson,
                      source: t.addSource,
                      claim: t.addClaim,
                      relationship: t.addRelation,
                    }[mode]}
            </h2>
          </div>
          <button
            className="icon-button"
            aria-label={t.close}
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <form onSubmit={submit}>
          <fieldset disabled={busy} className="stack">
            {mode === "person" && (
              <>
                <Field label={t.name}>
                  <input
                    autoFocus
                    name="name"
                    required
                    defaultValue={person?.name}
                  />
                </Field>
                <Field label={t.variants}>
                  <input
                    name="variants"
                    defaultValue={person?.variants.join("; ")}
                  />
                </Field>
                <Field label={t.date}>
                  <input name="dateText" defaultValue={person?.dateText} />
                </Field>
                <div className="form-grid">
                  <Field label={t.calendar}>
                    <select
                      name="calendar"
                      defaultValue={person?.calendar || "unknown"}
                    >
                      {Object.entries(t.calendarNames).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label={t.status}>
                    <select
                      name="livingStatus"
                      defaultValue={person?.livingStatus || "unknown"}
                    >
                      {Object.entries(t.living).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
                <Field label={t.notes}>
                  <textarea name="notes" defaultValue={person?.notes} />
                </Field>
              </>
            )}
            {mode === "source" && (
              <>
                <Field label={t.sourceTitle}>
                  <input
                    autoFocus
                    name="title"
                    required
                    defaultValue={source?.title}
                  />
                </Field>
                <Field label={t.citation}>
                  <input
                    name="citation"
                    required
                    defaultValue={source?.citation}
                  />
                </Field>
                <Field label={t.url}>
                  <input name="url" type="url" defaultValue={source?.url} />
                </Field>
                <Field label={t.originalId}>
                  <input name="originalId" defaultValue={source?.originalId} />
                  <small>{t.originalHelp}</small>
                </Field>
                {sourceArtifacts.length > 0 && (
                  <Field label={et.editArtifact}>
                    <select
                      value={editingArtifactId}
                      disabled={uploadSelected}
                      onChange={(event) =>
                        selectEditingArtifact(event.target.value)
                      }
                    >
                      {sourceArtifacts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} · {a.id.slice(-6)}
                        </option>
                      ))}
                    </select>
                    <small>{et.editArtifactHelp}</small>
                  </Field>
                )}
                <Field label={t.file}>
                  <input
                    ref={fileRef}
                    name="file"
                    type="file"
                    accept="image/png,image/jpeg,application/pdf,text/plain"
                    onChange={(event) => {
                      const selected = Boolean(event.target.files?.[0]?.name);
                      setUploadSelected(selected);
                      if (selected) {
                        setTranscription("");
                        setExportAllowed(true);
                      } else selectEditingArtifact(editingArtifactId);
                    }}
                  />
                  <small>{t.fileHint}</small>
                </Field>
                {uploadSelected && (
                  <>
                    <p className="notice">{et.newUpload}</p>
                    <button
                      className="text-button"
                      type="button"
                      onClick={clearUpload}
                    >
                      {et.clearUpload}
                    </button>
                  </>
                )}
                {artifact || uploadSelected ? (
                  <>
                    <Field label={t.transcription}>
                      <textarea
                        name="transcription"
                        rows={4}
                        value={transcription}
                        onChange={(event) =>
                          setTranscription(event.target.value)
                        }
                      />
                    </Field>
                    <label className="check">
                      <input
                        type="checkbox"
                        name="exportAllowed"
                        checked={exportAllowed}
                        onChange={(event) =>
                          setExportAllowed(event.target.checked)
                        }
                      />
                      {t.exportAllowed}
                    </label>
                  </>
                ) : (
                  <p className="muted">{et.noArtifact}</p>
                )}
                <Field label={t.notes}>
                  <textarea name="notes" defaultValue={source?.notes} />
                </Field>
              </>
            )}
            {mode === "claim" && (
              <>
                <Field label={t.subject}>
                  <select
                    name="personId"
                    required
                    defaultValue={claim?.personId}
                  >
                    {workspace.people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.dateText || p.id.slice(-5)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t.predicate}>
                  <input
                    autoFocus
                    name="predicate"
                    required
                    defaultValue={claim?.predicate}
                  />
                </Field>
                <Field label={t.value}>
                  <input name="value" required defaultValue={claim?.value} />
                </Field>
              </>
            )}
            {mode === "relationship" && (
              <>
                <Field label={t.from}>
                  <select name="from" required>
                    {workspace.people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.dateText || p.id.slice(-5)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t.to}>
                  <select
                    name="to"
                    required
                    defaultValue={workspace.people[1]?.id}
                  >
                    {workspace.people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.dateText || p.id.slice(-5)}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label={t.relationKind}>
                  <select name="kind">
                    {Object.entries(t.relationNames).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            )}
            {(mode === "claim" ||
              mode === "relationship" ||
              mode === "evidence") && (
              <>
                <Field label={t.rationale}>
                  <textarea
                    name="rationale"
                    required
                    defaultValue={claim?.rationale}
                  />
                </Field>
                {evidenceFields}
                <p className="notice">{t.reviewHint}</p>
              </>
            )}
            <div className="actions">
              <button className="button primary" type="submit">
                {busy ? t.saving : t.save}
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={onClose}
              >
                {t.cancel}
              </button>
            </div>
          </fieldset>
        </form>
      </section>
    </div>
  );
}
