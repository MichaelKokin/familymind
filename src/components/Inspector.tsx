"use client";
import { type FormEvent } from "react";
import type { Workspace } from "@/domain/model";
import { evidenceSummary, reviewProposal } from "@/domain/evidence";
import { ru as t } from "@/i18n/ru";
import { Field, type EditRequest } from "./Editor";
export default function Inspector({
  workspace,
  id,
  onSelect,
  onEdit,
  onChange,
  onError,
}: {
  workspace: Workspace;
  id: string;
  onSelect: (id: string) => void;
  onEdit: (e: EditRequest) => void;
  onChange: (w: Workspace) => void;
  onError: (e: unknown) => void;
}) {
  const p = workspace.people.find((x) => x.id === id),
    s = workspace.sources.find((x) => x.id === id),
    c = workspace.claims.find((x) => x.id === id),
    r = workspace.relationships.find((x) => x.id === id);
  const target = c || r;
  const summary = target ? evidenceSummary(workspace, id) : null;
  function decide(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const submitter = (e.nativeEvent as SubmitEvent)
      .submitter as HTMLButtonElement;
    try {
      onChange(
        reviewProposal(
          workspace,
          id,
          submitter.value as "accepted" | "rejected",
          String(fd.get("reason") || ""),
        ),
      );
    } catch (err) {
      onError(err);
    }
  }
  return (
    <div className="stack inspector-content">
      <div>
        <p className="eyebrow">{t.synthetic}</p>
        <h2>
          {p?.name ||
            s?.title ||
            (c
              ? `${c.predicate}: ${c.value}`
              : r
                ? t.relationNames[r.kind]
                : t.detail)}
        </h2>
      </div>
      {p && (
        <>
          <div className="person-identity">
            <div className="avatar large">
              {p.name
                .split(" ")
                .slice(0, 2)
                .map((x) => x[0])
                .join("")}
            </div>
            <div>
              <strong>{p.dateText || t.calendarNames.unknown}</strong>
              <p className="muted">{t.living[p.livingStatus]}</p>
            </div>
          </div>
          <p className="muted">{p.variants.join(" · ")}</p>
          <p>{p.notes}</p>
          <button
            className="button secondary"
            onClick={() => onEdit({ mode: "person", id })}
          >
            {t.edit}
          </button>
          <h3 className="section-title">{t.related}</h3>
          {workspace.claims
            .filter((x) => x.personId === id)
            .map((x) => (
              <button
                className="record"
                key={x.id}
                onClick={() => onSelect(x.id)}
              >
                <strong>
                  {x.predicate}: {x.value}
                </strong>
                <span className={`badge ${x.evidenceStatus}`}>
                  {t.evidenceNames[x.evidenceStatus]}
                </span>
              </button>
            ))}
          <h3 className="section-title">{t.relations}</h3>
          {workspace.relationships
            .filter((x) => x.fromPersonId === id || x.toPersonId === id)
            .map((x) => (
              <button
                className="record"
                key={x.id}
                onClick={() => onSelect(x.id)}
              >
                <strong>{t.relationNames[x.kind]}</strong>
                <span>
                  {
                    workspace.people.find(
                      (p) =>
                        p.id ===
                        (x.fromPersonId === id ? x.toPersonId : x.fromPersonId),
                    )?.name
                  }
                </span>
                <span className="badge">
                  {t.evidenceNames[x.evidenceStatus]}
                </span>
              </button>
            ))}
        </>
      )}
      {s && (
        <>
          <p>{s.citation}</p>
          <p className="muted break-word">{s.url}</p>
          <p className="original-label">
            {t.originalId}: <code>{s.originalId}</code>
          </p>
          <p>{s.notes}</p>
          <button
            className="button secondary"
            onClick={() => onEdit({ mode: "source", id })}
          >
            {t.edit}
          </button>
          {workspace.artifacts
            .filter((a) => a.sourceId === id)
            .map((a) => (
              <article key={a.id} className="artifact">
                <h3 className="section-title">
                  {t.original} · {a.name}
                </h3>
                {a.dataUrl ? (
                  <>
                    {a.mime.startsWith("image/") ? (
                      <img
                        className="document-image"
                        src={a.dataUrl}
                        alt={a.name}
                      />
                    ) : a.mime === "text/plain" ? (
                      <pre className="document-text">
                        {new TextDecoder().decode(
                          Uint8Array.from(atob(a.dataUrl.split(",")[1]), (c) =>
                            c.charCodeAt(0),
                          ),
                        )}
                      </pre>
                    ) : (
                      <div className="pdf-card">
                        PDF · {Math.ceil(a.size / 1024)} KB
                      </div>
                    )}
                    <a
                      className="button secondary"
                      href={a.dataUrl}
                      download={a.name}
                    >
                      {t.download}
                    </a>
                  </>
                ) : (
                  <p className="notice">{t.fileMissing}</p>
                )}
                <h3 className="section-title">{t.transcription}</h3>
                <p className="pre-wrap">{a.transcription || "—"}</p>
                <span className="badge">
                  {a.exportAllowed ? t.exportAllowed : t.exportExcluded}
                </span>
              </article>
            ))}
          <h3 className="section-title">{t.related}</h3>
          {workspace.evidence
            .filter((e) => e.sourceId === id)
            .map((e) => (
              <button
                key={e.id}
                className="record"
                onClick={() => onSelect(e.targetId)}
              >
                <span>
                  {t.polarities[e.polarity]} · {e.locator}
                </span>
                <strong>{e.excerpt}</strong>
              </button>
            ))}
        </>
      )}
      {target && summary && (
        <>
          {r && (
            <div className="relation-people">
              {[r.fromPersonId, r.toPersonId].map((pid, i) => (
                <button
                  className="text-button"
                  key={pid}
                  onClick={() => onSelect(pid)}
                >
                  {i ? "→ " : ""}
                  {workspace.people.find((p) => p.id === pid)?.name}
                </button>
              ))}
            </div>
          )}
          {c && (
            <button
              className="text-button"
              onClick={() => onSelect(c.personId)}
            >
              {workspace.people.find((p) => p.id === c.personId)?.name}
            </button>
          )}
          <div className="status-grid">
            <div>
              <small>{t.evidenceStatus}</small>
              <span
                className={`badge ${target.evidenceStatus}`}
                data-testid="evidence-status"
              >
                {t.evidenceNames[target.evidenceStatus]}
              </span>
            </div>
            <div>
              <small>{t.workflow}</small>
              <span className="badge" data-testid="workflow-status">
                {t.workflowNames[target.workflowStatus]}
              </span>
            </div>
          </div>
          <p className="pre-wrap">{target.rationale}</p>
          <div className="evidence-count">
            <strong>{summary.independentCount}</strong>
            <span>{t.independent}</span>
            <strong>{summary.duplicateCount}</strong>
            <span>{t.copies}</span>
          </div>
          <h3 className="section-title">{t.evidence}</h3>
          {workspace.evidence
            .filter((e) => e.targetId === id)
            .map((e) => (
              <article className={`evidence-card ${e.polarity}`} key={e.id}>
                <span className="badge">{t.polarities[e.polarity]}</span>
                <h4>
                  {workspace.sources.find((s) => s.id === e.sourceId)?.title}
                </h4>
                <p className="muted">{e.locator}</p>
                <blockquote>{e.excerpt}</blockquote>
                <p>{e.rationale}</p>
                <small>
                  {t.group}: {e.independenceGroup}
                </small>
                <button
                  className="text-button"
                  onClick={() => onSelect(e.sourceId)}
                >
                  {t.sourceOpen} ↗
                </button>
              </article>
            ))}
          {!workspace.evidence.some((e) => e.targetId === id) && (
            <p className="notice">{t.unsupported}</p>
          )}
          <button
            className="button secondary"
            onClick={() => onEdit({ mode: "evidence", id })}
          >
            {t.addEvidence}
          </button>
          <section className="review-form">
            <h3>{t.workflow}</h3>
            <p className="muted">{t.reviewHint}</p>
            <form onSubmit={decide} className="stack">
              <Field label={t.reason}>
                <textarea name="reason" required minLength={3} />
              </Field>
              <div className="actions">
                <button
                  className="button primary"
                  name="decision"
                  value="accepted"
                >
                  {t.accept}
                </button>
                <button
                  className="button secondary"
                  name="decision"
                  value="rejected"
                >
                  {t.reject}
                </button>
              </div>
            </form>
          </section>
          <h3 className="section-title">{t.history}</h3>
          {workspace.reviews
            .filter((x) => x.targetId === id)
            .map((x) => (
              <div className="history-record" key={x.id}>
                <strong>{t.workflowNames[x.decision]}</strong>
                <p>{x.reason}</p>
                <small>{new Date(x.createdAt).toLocaleString("ru-RU")}</small>
              </div>
            ))}
        </>
      )}
    </div>
  );
}
