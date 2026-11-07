"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { DomainError, parseWorkspace, type Workspace } from "@/domain/model";
import { createDemoWorkspace, createEmptyWorkspace } from "@/domain/seed";
import { findConflicts } from "@/domain/evidence";
import { WorkspaceRepository } from "@/data/repository";
import { exportPackage, importPackage } from "@/data/transfer";
import { validateWorkspaceFiles, MAX_PACKAGE_BYTES } from "@/data/files";
import { errors } from "@/i18n/errors";
import { ru as t } from "@/i18n/ru";
import FamilyCanvas from "./FamilyCanvas";
import Modal from "./Modal";
import Inspector from "./Inspector";
import Editor, { Field, type EditRequest } from "./Editor";
import ResearchPanel from "./ResearchPanel";

type Section = "all" | "people" | "sources" | "claims" | "review" | "research";
function download(text: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function WorkspaceApp() {
  const repo = useRef<WorkspaceRepository | null>(null);
  const current = useRef<Workspace | null>(null);
  const busy = useRef(false);
  const pending = useRef<Workspace | null>(null);
  const pendingReplacement = useRef(false);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [status, setStatus] = useState<
    "loading" | "saved" | "saving" | "error"
  >("loading");
  const [error, setError] = useState("");
  const [section, setSection] = useState<Section>("all");
  const [view, setView] = useState<"canvas" | "list">("canvas");
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<EditRequest | null>(null);
  const [projectAction, setProjectAction] = useState<"empty" | "demo" | null>(
    null,
  );
  const [importOpen, setImportOpen] = useState(false);
  const [imported, setImported] = useState<Workspace | null>(null);
  function report(e: unknown) {
    setError(
      e instanceof DomainError
        ? errors[e.code] || t.errorGeneric
        : e instanceof DOMException && e.name === "QuotaExceededError"
          ? errors.QUOTA_EXCEEDED
          : t.errorGeneric,
    );
  }
  useEffect(() => {
    let active = true;
    const repository = new WorkspaceRepository();
    repo.current = repository;
    async function load() {
      try {
        let w = await repository.load();
        if (!active) return;
        if (!w) {
          try {
            w = await repository.save(createDemoWorkspace(), null);
          } catch (e) {
            if (e instanceof DomainError && e.code === "STALE_REVISION") {
              w = await repository.load();
              if (!w) throw e;
            } else throw e;
          }
        }
        if (active) {
          current.current = w;
          setWorkspace(w);
          if (window.matchMedia("(max-width: 600px)").matches) setView("list");
          setStatus("saved");
        }
      } catch (e) {
        if (active) {
          report(e);
          setStatus("error");
        }
      }
    }
    void load();
    return () => {
      active = false;
      void repository.close();
    };
  }, []);
  useEffect(() => {
    function warn(e: BeforeUnloadEvent) {
      if (busy.current || pending.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  async function save(w: Workspace, replacement = false): Promise<boolean> {
    if (busy.current) {
      setError(errors.SAVE_BUSY);
      return false;
    }
    try {
      parseWorkspace(w);
      validateWorkspaceFiles(w);
      if (!replacement && w.revision !== current.current?.revision)
        throw new DomainError("STALE_REVISION");
    } catch (e) {
      report(e);
      return false;
    }
    busy.current = true;
    pending.current = w;
    pendingReplacement.current = replacement;
    setStatus("saving");
    setError("");
    try {
      const saved = await repo.current!.save(
        w,
        current.current?.revision ?? null,
      );
      current.current = saved;
      setWorkspace(saved);
      pending.current = null;
      setStatus("saved");
      return true;
    } catch (e) {
      setStatus("error");
      report(e);
      return false;
    } finally {
      busy.current = false;
    }
  }
  function select(id: string) {
    setSelected(id);
    if (current.current?.questions.some((q) => q.id === id))
      setSection("research");
  }
  async function reload() {
    try {
      const w = await repo.current!.load();
      if (w) {
        pending.current = null;
        current.current = w;
        setWorkspace(w);
        setStatus("saved");
        setError("");
        setEdit(null);
        setSelected(null);
        setSection("all");
      }
    } catch (e) {
      report(e);
    }
  }
  function exportCurrent() {
    try {
      download(
        exportPackage(pending.current || current.current!),
        "family-mind-m0.json",
      );
    } catch (e) {
      report(e);
    }
  }
  const list = workspace
    ? [
        ...workspace.people.map((p) => ({
          id: p.id,
          type: "people" as Section,
          title: p.name,
          detail: p.dateText || t.calendarNames.unknown,
          status: t.person,
        })),
        ...workspace.sources.map((s) => ({
          id: s.id,
          type: "sources" as Section,
          title: s.title,
          detail: s.citation,
          status: t.source,
        })),
        ...workspace.claims.map((c) => ({
          id: c.id,
          type: "claims" as Section,
          title: `${c.predicate}: ${c.value}`,
          detail: workspace.people.find((p) => p.id === c.personId)?.name || "",
          status: t.evidenceNames[c.evidenceStatus],
          workflow: c.workflowStatus,
        })),
        ...workspace.relationships.map((r) => ({
          id: r.id,
          type: "claims" as Section,
          title: t.relationNames[r.kind],
          detail: [r.fromPersonId, r.toPersonId]
            .map((id) => workspace.people.find((p) => p.id === id)?.name)
            .join(" → "),
          status: t.evidenceNames[r.evidenceStatus],
          workflow: r.workflowStatus,
        })),
        ...workspace.questions.map((q) => ({
          id: q.id,
          type: "research" as Section,
          title: q.question,
          detail: q.place,
          status: t.question,
        })),
      ]
    : [];
  const filtered = list.filter(
    (o) =>
      (section === "all" ||
        section === o.type ||
        (section === "review" &&
          "workflow" in o &&
          ["proposed", "needs_review"].includes(o.workflow || ""))) &&
      `${o.title} ${o.detail}`.toLowerCase().includes(search.toLowerCase()),
  );
  const reviewCount = workspace
    ? [...workspace.claims, ...workspace.relationships].filter((o) =>
        ["proposed", "needs_review"].includes(o.workflowStatus),
      ).length
    : 0;
  const conflicts = workspace ? findConflicts(workspace) : [];
  if (!workspace)
    return (
      <main className="loading-screen">
        <div className="brand-mark">
          f<span>m</span>
        </div>
        <h1>{t.brand}</h1>
        <p role="status">{status === "loading" ? t.loading : error}</p>
        {status === "error" && (
          <button className="button primary" onClick={() => location.reload()}>
            {t.reload}
          </button>
        )}
      </main>
    );
  const navs: Array<{
    id: Section;
    label: string;
    icon: string;
    count: number;
  }> = [
    { id: "all", label: t.all, icon: "▦", count: list.length },
    {
      id: "people",
      label: t.people,
      icon: "♧",
      count: workspace.people.length,
    },
    {
      id: "sources",
      label: t.sources,
      icon: "▤",
      count: workspace.sources.length,
    },
    {
      id: "claims",
      label: t.claims,
      icon: "◇",
      count: workspace.claims.length + workspace.relationships.length,
    },
    { id: "review", label: t.review, icon: "◎", count: reviewCount },
    {
      id: "research",
      label: t.research,
      icon: "⌕",
      count: workspace.questions.length,
    },
  ];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand" aria-label={t.brand}>
          <span className="brand-mark">
            f<span>m</span>
          </span>
          <span>
            <strong>{t.brand}</strong>
            <small>{t.tagline}</small>
          </span>
        </div>
        <div className="project-card">
          <span className="project-avatar">В</span>
          <div>
            <small>{t.local}</small>
            <strong>{workspace.title}</strong>
          </div>
          <span className="chevron">⌄</span>
        </div>
        <nav aria-label={t.all}>
          {navs.map((n) => (
            <button
              key={n.id}
              className={`nav-item ${section === n.id ? "active" : ""}`}
              aria-pressed={section === n.id}
              onClick={() => {
                setSection(n.id);
                if (n.id !== "all") setView("list");
                if (n.id === "research") {
                  setSelected(workspace.questions[0]?.id || null);
                } else setSelected(null);
              }}
            >
              <span className="nav-icon">{n.icon}</span>
              {n.label}
              <span className="nav-count">{n.count}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-add">
          <button
            className="button primary"
            onClick={() => setEdit({ mode: "person" })}
          >
            ＋ {t.addPerson}
          </button>
          <button
            className="button secondary"
            onClick={() => setEdit({ mode: "source" })}
          >
            ＋ {t.addSource}
          </button>
        </div>
        <div className="sidebar-bottom">
          <div className="local-indicator">
            <span />
            {t.workspaceLocal}
          </div>
          <p>{t.storageHint}</p>
          <details>
            <summary>{t.integrations}</summary>
            <p>
              {t.manual}
              <br />
              {t.archives}
              <br />
              {t.ai}
            </p>
          </details>
          <div className="project-actions">
            <button
              className="text-button"
              onClick={() => setProjectAction("empty")}
            >
              {t.newProject}
            </button>
            <button
              className="text-button"
              onClick={() => setProjectAction("demo")}
            >
              {t.demoProject}
            </button>
          </div>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div className={`save-state ${status}`} role="status">
            <span />
            {status === "saved"
              ? t.saved
              : status === "saving"
                ? t.saving
                : t.saveError}
          </div>
          <div className="top-actions">
            <Link className="button secondary" href="/case">
              {t.privateResearch}
            </Link>
            <button
              className="button ghost"
              onClick={() => {
                setImportOpen(true);
                setImported(null);
              }}
            >
              ↓ {t.import}
            </button>
            <button className="button secondary" onClick={exportCurrent}>
              ↑ {t.export}
            </button>
          </div>
        </header>
        <div className="demo-banner">
          <span className="demo-tag">{t.demo}</span>
          <span>{t.demoNote}</span>
          <span className="demo-lock">◈</span>
        </div>
        {error && (
          <div role="alert" className="error-banner">
            <span>{error}</span>
            {status === "error" && (
              <div className="actions">
                {
                  <button
                    onClick={() => {
                      if (pending.current)
                        void save(pending.current, pendingReplacement.current);
                    }}
                  >
                    {t.retry}
                  </button>
                }
                <button onClick={() => void reload()}>{t.reload}</button>
              </div>
            )}
            <button aria-label={t.close} onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        <section className="workspace-intro">
          <div>
            <p className="eyebrow">{t.overview}</p>
            <h1>
              {section === "all"
                ? t.title
                : navs.find((n) => n.id === section)?.label}
            </h1>
            <p className="muted">{t.subtitle}</p>
          </div>
          <div className="workspace-stats">
            <span>
              <strong>
                {workspace.people.length.toString().padStart(2, "0")}
              </strong>
              {t.countPeople}
            </span>
            <span>
              <strong>
                {workspace.sources.length.toString().padStart(2, "0")}
              </strong>
              {t.countSources}
            </span>
            <span>
              <strong>{reviewCount.toString().padStart(2, "0")}</strong>
              {t.countReview}
            </span>
          </div>
        </section>
        <div className="workspace-toolbar">
          <label className="search-field">
            <span>⌕</span>
            <input
              aria-label={t.search}
              placeholder={t.search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="view-toggle">
            <button
              aria-pressed={view === "canvas"}
              onClick={() => {
                setView("canvas");
                setSection("all");
              }}
            >
              ▦ {t.canvas}
            </button>
            <button
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
            >
              ☷ {t.list}
            </button>
          </div>
          <button
            className="button small secondary"
            disabled={!workspace.people.length}
            onClick={() => setEdit({ mode: "claim" })}
          >
            {t.addClaim}
          </button>
          <button
            className="button small secondary"
            disabled={workspace.people.length < 2}
            onClick={() => setEdit({ mode: "relationship" })}
          >
            {t.addRelation}
          </button>
        </div>
        <div
          className={`workspace-body ${selected || section === "research" ? "with-inspector" : ""}`}
        >
          <section
            className="work-surface"
            aria-label={view === "canvas" ? t.canvas : t.list}
          >
            {conflicts.length > 0 && (
              <button
                className="conflict-strip"
                onClick={() => {
                  setSelected(conflicts[0].claimIds[0]);
                  setSection("all");
                }}
              >
                <span>◇</span>
                <strong>{t.conflicts}</strong>
                <span>{conflicts[0].values.join(" / ")}</span>
                <span className="conflict-arrow">{t.open} →</span>
              </button>
            )}
            {!list.length ? (
              <div className="empty-state">
                <span className="empty-icon">✧</span>
                <h2>{t.empty}</h2>
                <p>{t.emptyText}</p>
                <button
                  className="button primary"
                  onClick={() => setEdit({ mode: "person" })}
                >
                  {t.addPerson}
                </button>
              </div>
            ) : view === "canvas" && section === "all" ? (
              <FamilyCanvas
                workspace={workspace}
                selectedId={selected}
                filter={search}
                onSelect={select}
                onPositionsChange={(positions) =>
                  void save({
                    ...workspace,
                    positions: { ...workspace.positions, ...positions },
                  })
                }
              />
            ) : (
              <div className="object-list">
                {filtered.map((o) => (
                  <button
                    key={o.id}
                    data-testid={`object-${o.id}`}
                    className={`object-row ${selected === o.id ? "selected" : ""}`}
                    onClick={() => select(o.id)}
                  >
                    <span className={`object-icon ${o.type}`}>
                      {o.type === "people"
                        ? "◉"
                        : o.type === "sources"
                          ? "▤"
                          : o.type === "research"
                            ? "?"
                            : "◇"}
                    </span>
                    <span className="object-copy">
                      <strong>{o.title}</strong>
                      <span>{o.detail}</span>
                    </span>
                    <span className="badge">{o.status}</span>
                    <span className="row-arrow">↗</span>
                  </button>
                ))}
                {!filtered.length && (
                  <div className="empty-state">
                    <h2>
                      {section === "review" ? t.reviewEmpty : t.noResults}
                    </h2>
                  </div>
                )}
              </div>
            )}
          </section>
          {(selected || section === "research") && (
            <aside className="inspector" aria-label={t.detail}>
              <div className="inspector-top">
                <span>{section === "research" ? t.research : t.detail}</span>
                <button
                  className="icon-button"
                  aria-label={t.close}
                  onClick={() => {
                    setSelected(null);
                    if (section === "research") setSection("all");
                  }}
                >
                  ×
                </button>
              </div>
              <fieldset
                disabled={status === "saving"}
                className="inspector-fieldset"
              >
                {section === "research" ? (
                  <ResearchPanel
                    workspace={workspace}
                    selectedId={selected}
                    onChange={save}
                    onSelect={select}
                    onOpenSource={(id) => {
                      setSection("all");
                      setSelected(id);
                    }}
                  />
                ) : selected ? (
                  <Inspector
                    workspace={workspace}
                    id={selected}
                    onSelect={select}
                    onEdit={setEdit}
                    onChange={(w) => {
                      void save(w);
                    }}
                    onError={report}
                  />
                ) : null}
              </fieldset>
            </aside>
          )}
        </div>
        <footer>
          {t.footer}
          <span>Family Mind / M0 · 2026</span>
        </footer>
      </main>
      {edit && (
        <Editor
          key={`${edit.mode}-${edit.id}`}
          request={edit}
          workspace={workspace}
          onClose={() => setEdit(null)}
          onError={report}
          onSave={async (w, id) => {
            const ok = await save(w);
            if (ok) {
              setEdit(null);
              setSection("all");
              setSelected(id);
            }
            return ok;
          }}
        />
      )}
      {projectAction && (
        <Modal
          title={t.newProject}
          onClose={() => setProjectAction(null)}
          busy={status === "saving"}
        >
          <h2>{projectAction === "empty" ? t.newProject : t.demoProject}</h2>
          <p className="muted">{t.replaceHint}</p>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const w =
                projectAction === "demo"
                  ? createDemoWorkspace()
                  : createEmptyWorkspace(String(fd.get("title")));
              if (await save(w, true)) {
                setProjectAction(null);
                setSelected(null);
                setSection("all");
                setSearch("");
              }
            }}
          >
            {projectAction === "empty" && (
              <Field label={t.projectName}>
                <input autoFocus required name="title" />
              </Field>
            )}
            <div className="actions">
              <button disabled={status === "saving"} className="button primary">
                {t.replace}
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={() => setProjectAction(null)}
              >
                {t.cancel}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {importOpen && (
        <Modal
          title={t.import}
          onClose={() => setImportOpen(false)}
          busy={status === "saving"}
        >
          <h2>{t.import}</h2>
          <p className="muted">{t.importHint}</p>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              setImported(null);
              const f = new FormData(e.currentTarget).get("package");
              try {
                if (!(f instanceof File) || f.size > MAX_PACKAGE_BYTES)
                  throw new DomainError("PACKAGE_TOO_LARGE");
                setImported(importPackage(await f.text()));
              } catch (error) {
                report(error);
              }
            }}
          >
            <Field label={t.importFile}>
              <input
                type="file"
                name="package"
                accept=".json,application/json"
                required
                onChange={() => setImported(null)}
              />
            </Field>
            <button className="button secondary">{t.importCheck}</button>
          </form>
          {imported && (
            <div className="import-preview stack">
              <p className="notice">{t.importReady}</p>
              <strong>{imported.title}</strong>
              <p>
                {imported.people.length} {t.countPeople} ·{" "}
                {imported.sources.length} {t.countSources}
              </p>
              <button
                className="button primary"
                disabled={status === "saving"}
                onClick={async () => {
                  if (await save(imported, true)) {
                    setImportOpen(false);
                    setImported(null);
                    setSelected(null);
                    setSection("all");
                    setSearch("");
                  }
                }}
              >
                {t.importConfirm}
              </button>
            </div>
          )}
          <button className="text-button" onClick={() => setImportOpen(false)}>
            {t.cancel}
          </button>
        </Modal>
      )}
    </div>
  );
}
