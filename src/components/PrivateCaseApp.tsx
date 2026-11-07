"use client";

import { useRouter } from "next/navigation";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  parsePrivateCase,
  type AIRun,
  type PrivateCase,
  type PrivateSource,
  type Proposal,
} from "@/private-case/model";
import { privateCaseText as t } from "@/i18n/private-case";
import Modal from "./Modal";
import styles from "@/app/case/case.module.css";

class RequestError extends Error {
  constructor(
    readonly code: string,
    readonly status = 0,
  ) {
    super(code);
  }
}

async function api(path: string, body?: unknown): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`/api/private/${path}`, {
      method: body === undefined ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    const result: unknown = await response.json().catch(() => null);
    if (controller.signal.aborted) throw new RequestError("REQUEST_TIMEOUT");
    if (!response.ok) {
      const code =
        result &&
        typeof result === "object" &&
        "error" in result &&
        typeof result.error === "string"
          ? result.error
          : "UNKNOWN";
      throw new RequestError(code, response.status);
    }
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw new RequestError("REQUEST_TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function errorText(error: unknown): string {
  const code =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
      ? error.code
      : "";
  return (
    t.errors[code] ??
    (error instanceof RequestError && error.status === 401
      ? t.errors.UNAUTHORIZED
      : error instanceof RequestError && error.status === 403
        ? t.errors.FORBIDDEN
        : t.errorGeneric)
  );
}

function dateText(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Madrid",
  }).format(new Date(value));
}

function isActive(run: AIRun) {
  return run.status === "queued" || run.status === "running";
}

function SourceLinks({
  ids,
  sources,
  onOpen,
}: {
  ids: string[];
  sources: PrivateSource[];
  onOpen: (id: string) => void;
}) {
  return (
    <div className={styles.sourceLinks}>
      {ids.map((id) => {
        const source = sources.find((item) => item.id === id);
        return source ? (
          <button
            type="button"
            key={id}
            onClick={() => onOpen(id)}
            title={t.openSource}
          >
            ↗ {source.title}
          </button>
        ) : null;
      })}
    </div>
  );
}

export default function PrivateCaseApp() {
  const router = useRouter();
  const bootstrap = useRef<Promise<PrivateCase> | null>(null);
  const openExplore = useRef(false);
  const authEpoch = useRef(0);
  const [data, setData] = useState<PrivateCase | null>(null);
  const latestCase = useRef<PrivateCase | null>(null);
  const acceptCase = useCallback((value: PrivateCase): boolean => {
    if (
      latestCase.current?.id === value.id &&
      latestCase.current.revision > value.revision
    )
      return false;
    latestCase.current = value;
    setData(value);
    return true;
  }, []);
  const [state, setState] = useState<"loading" | "ready" | "locked">("loading");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [question, setQuestion] = useState("");
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const [selectedRun, setSelectedRun] = useState<string | null>(null);
  const [sourceFormOpen, setSourceFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [stagedImport, setStagedImport] = useState<PrivateCase | null>(null);
  const [dialogError, setDialogError] = useState("");
  const importCheckId = useRef(0);

  const lockIfUnauthorized = (failure: unknown) => {
    if (failure instanceof RequestError && failure.status === 401) {
      authEpoch.current += 1;
      latestCase.current = null;
      setData(null);
      setState("locked");
      setSourceFormOpen(false);
      setImportOpen(false);
      setSelectedSource(null);
    }
  };

  useEffect(() => {
    let active = true;
    const receiveAccessLink = () => {
      if (new URLSearchParams(window.location.hash.slice(1)).get("token")) {
        // Navigating from /case to /case#token does not remount this component.
        // Reload keeps the fragment local and uses the same one-shot exchange
        // as a new tab; mount immediately removes the secret from the URL.
        window.location.reload();
      }
    };
    window.addEventListener("hashchange", receiveAccessLink);
    if (!bootstrap.current) {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const token = fragment.get("token");
      openExplore.current = Boolean(token && fragment.get("view") === "explore");
      window.history.replaceState(null, "", window.location.pathname);
      bootstrap.current = (async () => {
        if (token) await api("session", { token });
        return parsePrivateCase(await api("case"));
      })();
    }
    void bootstrap.current
      .then((value) => {
        if (!active) return;
        if (openExplore.current) {
          window.location.replace("/case/explore");
          return;
        }
        if (!acceptCase(value)) return;
        setQuestion(value.question);
        setSourceIds(value.sources.map((source) => source.id));
        setState("ready");
      })
      .catch((failure: unknown) => {
        if (active) {
          setError(errorText(failure));
          setState("locked");
        }
      });
    return () => {
      active = false;
      window.removeEventListener("hashchange", receiveAccessLink);
    };
  }, [acceptCase]);

  const activeRunIds =
    data?.aiRuns
      .filter(isActive)
      .map((run) => run.id)
      .join(",") ?? "";
  useEffect(() => {
    if (!activeRunIds) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const epoch = authEpoch.current;
      try {
        const value = parsePrivateCase(await api("case"));
        if (!stopped && epoch === authEpoch.current) acceptCase(value);
      } catch (failure) {
        if (!stopped && epoch === authEpoch.current) {
          setError(errorText(failure));
          if (failure instanceof RequestError && failure.status === 401) {
            authEpoch.current += 1;
            latestCase.current = null;
            setData(null);
            setState("locked");
          }
        }
      }
      if (!stopped)
        timer = setTimeout(() => {
          void poll();
        }, 2000);
    };
    timer = setTimeout(() => {
      void poll();
    }, 2000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [activeRunIds, acceptCase]);

  const reload = async () => {
    const epoch = authEpoch.current;
    try {
      const value = parsePrivateCase(await api("case"));
      if (epoch !== authEpoch.current || !acceptCase(value)) return;
      setState("ready");
      setError("");
      setSourceIds((previous) =>
        previous.length
          ? previous.filter((id) =>
              value.sources.some((source) => source.id === id),
            )
          : value.sources.map((source) => source.id),
      );
      if (!question) setQuestion(value.question);
    } catch (failure) {
      if (epoch === authEpoch.current) {
        setError(errorText(failure));
        lockIfUnauthorized(failure);
      }
    }
  };

  const mutate = async (
    path: string,
    body: unknown,
  ): Promise<PrivateCase | null> => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setDialogError("");
    const epoch = authEpoch.current;
    try {
      const value = parsePrivateCase(await api(path, body));
      if (epoch !== authEpoch.current) return null;
      acceptCase(value);
      return latestCase.current;
    } catch (failure) {
      if (epoch !== authEpoch.current) return null;
      const message = errorText(failure);
      setError(message);
      setDialogError(message);
      lockIfUnauthorized(failure);
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const analyze = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!data || !sourceIds.length) return;
    const value = await mutate("analyze", {
      expectedRevision: data.revision,
      question: question.trim(),
      sourceIds,
    });
    if (value) setSelectedRun(value.aiRuns.at(-1)?.id ?? null);
  };

  const addSource = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!data) return;
    const fields = new FormData(event.currentTarget);
    const source = Object.fromEntries(
      ["title", "url", "locator", "excerpt", "kind"].map((key) => [
        key,
        String(fields.get(key) ?? "").trim(),
      ]),
    );
    const value = await mutate("source", {
      expectedRevision: data.revision,
      source,
    });
    if (value) {
      const addedIds = value.sources
        .filter(
          (item) => !data.sources.some((existing) => existing.id === item.id),
        )
        .map((item) => item.id);
      setSourceIds((previous) => [...new Set([...previous, ...addedIds])]);
      setSourceFormOpen(false);
    }
  };

  const exportCase = async (format: "case" | "registers" = "case") => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const epoch = authEpoch.current;
    try {
      const response = await api(
        format === "registers" ? "export?format=registers" : "export",
        {},
      );
      const value = format === "case" ? parsePrivateCase(response) : response;
      if (epoch !== authEpoch.current) return;
      if (!value || typeof value !== "object")
        throw new RequestError("INVALID_RESPONSE");
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(value, null, 2)], {
          type: "application/json;charset=utf-8",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download =
        format === "registers"
          ? "familymind-evidence-registers.json"
          : "family-mind-private-case.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (failure) {
      setError(errorText(failure));
      lockIfUnauthorized(failure);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const logout = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    authEpoch.current += 1;
    setBusy(true);
    try {
      await api("logout", {});
      bootstrap.current = null;
      latestCase.current = null;
      setData(null);
      setQuestion("");
      setSourceIds([]);
      setSelectedSource(null);
      setState("locked");
      setError(t.signedOut);
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const checkImport = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setDialogError("");
    setStagedImport(null);
    const checkId = ++importCheckId.current;
    try {
      const file = new FormData(event.currentTarget).get("backup");
      if (!(file instanceof File) || file.size > 4 * 1024 * 1024)
        throw new RequestError("CASE_TOO_LARGE");
      let input: unknown;
      try {
        input = JSON.parse(await file.text());
      } catch {
        throw new RequestError("INVALID_JSON");
      }
      const value = parsePrivateCase(input);
      if (value.id !== data?.id) throw new RequestError("CASE_ID_MISMATCH");
      if (checkId === importCheckId.current) setStagedImport(value);
    } catch (failure) {
      if (checkId === importCheckId.current) setDialogError(errorText(failure));
    }
  };

  if (state !== "ready" || !data)
    return (
      <main
        className={`${styles.root} ${styles.locked}`}
        data-testid="private-case-locked"
      >
        <div className={styles.wordmark}>
          {t.brand}
          <span>{t.private}</span>
        </div>
        <div className={styles.lockedCard}>
          <span className={styles.lockIcon}>◈</span>
          <h1>{state === "loading" ? t.loading : t.locked}</h1>
          <p>{t.lockedHint}</p>
          {error && (
            <p role="alert" className={styles.errorText}>
              {error}
            </p>
          )}
          {state === "locked" && (
            <>
            <p>{t.recoveryCommand} <code>npm run case:launch</code></p>
            <p>{t.recoveryBrowser}</p>
            <button
              className={styles.primary}
              onClick={() => {
                void reload();
              }}
            >
              {t.retry}
            </button>
            </>
          )}
        </div>
      </main>
    );

  const active = data.aiRuns.some(isActive);
  const run =
    data.aiRuns.find((item) => item.id === selectedRun) ?? data.aiRuns.at(-1);
  const source = data.sources.find((item) => item.id === selectedSource);
  const openSource = (id: string) => setSelectedSource(id);
  const chains = data.sources
    .map((item) => item.independenceGroup)
    .filter(Boolean);
  const hasSharedChain = new Set(chains).size < chains.length;

  return (
    <div className={styles.root} data-testid="private-case">
      <header className={styles.header}>
        <a className={styles.wordmark} href="/case">
          {t.brand}
          <span>{t.private}</span>
        </a>
        <div className={styles.headerActions}>
          <span className={styles.local}>
            <i />
            {t.local}
          </span>
          <button type="button" onClick={() => window.open("/api/private/report", "_blank", "noopener,noreferrer")}>
            {t.report}
          </button>
          <button type="button" onClick={() => router.push("/case/explore")}>{t.explore}</button>
          <button
            onClick={() => {
              void exportCase();
            }}
            disabled={busy}
          >
            {t.export}
          </button>
          <button
            onClick={() => {
              void exportCase("registers");
            }}
            disabled={busy}
          >
            {t.exportRegisters}
          </button>
          <button
            onClick={() => {
              setImportOpen(true);
              setStagedImport(null);
              setDialogError("");
            }}
            disabled={busy || active}
            title={active ? t.importNotWhileRunning : undefined}
          >
            {t.import}
          </button>
          <button
            onClick={() => {
              void logout();
            }}
            disabled={busy}
          >
            {t.logout}
          </button>
        </div>
      </header>
      {error && (
        <div className={styles.errorBanner} role="alert">
          <span>{error}</span>
          <button
            onClick={() => {
              void reload();
            }}
          >
            {t.reload}
          </button>
          <button aria-label={t.dismiss} onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      <div className={styles.workspace}>
        <aside className={styles.sidebar}>
          <p className={styles.eyebrow}>{t.subject}</p>
          <h1>{data.subject.name}</h1>
          <p className={styles.subjectDate}>
            {data.subject.dateText || t.unknownDate}
          </p>
          <span className={styles.badge}>
            {t.living[data.subject.livingStatus]}
          </span>
          <div className={styles.sidebarSection}>
            <div className={styles.sectionHeading}>
              <h2>{t.sources}</h2>
              <span>{data.sources.length.toString().padStart(2, "0")}</span>
            </div>
            <div className={styles.sourceList}>
              {data.sources.map((item, index) => (
                <button
                  key={item.id}
                  className={styles.sourceCard}
                  onClick={() => openSource(item.id)}
                >
                  <span className={styles.sourceNumber}>
                    {(index + 1).toString().padStart(2, "0")}
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{t.sourceKinds[item.kind]}</small>
                  </span>
                  <span>↗</span>
                </button>
              ))}
            </div>
            {!data.sources.length && (
              <p className={styles.hint}>{t.noSources}</p>
            )}
            {hasSharedChain && (
              <p className={styles.hint}>{t.sharedChainHint}</p>
            )}
            <button
              className={styles.secondary}
              onClick={() => {
                setSourceFormOpen(true);
                setDialogError("");
              }}
            >
              ＋ {t.addSource}
            </button>
          </div>
          <div className={styles.sidebarSection}>
            <h2>{t.known}</h2>
            <p className={styles.hint}>{t.knownHint}</p>
            <div className={styles.knownList}>
              {data.known.map((item) => (
                <article key={item.id}>
                  <span className={styles.badge}>
                    {t.knownStatuses[item.status]}
                  </span>
                  <p>{item.text}</p>
                  <SourceLinks
                    ids={item.sourceIds}
                    sources={data.sources}
                    onOpen={openSource}
                  />
                </article>
              ))}
            </div>
            {!data.known.length && <p className={styles.hint}>{t.noKnown}</p>}
          </div>
          {data.notes && (
            <details className={styles.caseNotes}>
              <summary>{t.notes}</summary>
              <p>{data.notes}</p>
            </details>
          )}
        </aside>
        <main className={styles.main}>
          <section className={styles.questionPanel}>
            <p className={styles.eyebrow}>{t.desk}</p>
            <h2>{data.title}</h2>
            <p className={styles.hint}>{t.readBeforeRun}</p>
            <form onSubmit={analyze} className={styles.questionForm}>
              <label>
                {t.questionLabel}
                <textarea
                  rows={3}
                  minLength={5}
                  maxLength={1000}
                  required
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  disabled={busy || active}
                />
              </label>
              <fieldset disabled={busy || active} className={styles.scope}>
                <legend>{t.scope}</legend>
                <p>{t.scopeHint}</p>
                <div>
                  {data.sources.map((item) => (
                    <label key={item.id}>
                      <input
                        type="checkbox"
                        checked={sourceIds.includes(item.id)}
                        onChange={(event) =>
                          setSourceIds((previous) =>
                            event.target.checked
                              ? [...previous, item.id]
                              : previous.filter((id) => id !== item.id),
                          )
                        }
                      />
                      <span>{item.title}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className={styles.launchRow}>
                <button
                  className={styles.primary}
                  disabled={
                    busy ||
                    active ||
                    !sourceIds.length ||
                    question.trim().length < 5
                  }
                >
                  {active ? t.analyzing : t.analyze}
                  <span aria-hidden="true"> ↗</span>
                </button>
                <p>{sourceIds.length ? t.analysisNote : t.noScope}</p>
              </div>
            </form>
          </section>
          <section className={styles.results}>
            <div className={styles.sectionHeading}>
              <h2>{t.activity}</h2>
              {data.aiRuns.length > 1 && (
                <select
                  aria-label={t.activity}
                  value={run?.id ?? ""}
                  onChange={(event) => setSelectedRun(event.target.value)}
                >
                  {[...data.aiRuns].reverse().map((item) => (
                    <option key={item.id} value={item.id}>
                      {dateText(item.startedAt)} · {t.runStates[item.status]}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {run ? (
              <RunView
                key={run.id}
                run={run}
                data={data}
                onOpenSource={openSource}
                busy={busy}
                onReview={async (proposalId, decision, reason) =>
                  Boolean(
                    await mutate("review", {
                      expectedRevision: data.revision,
                      runId: run.id,
                      proposalId,
                      decision,
                      reason,
                    }),
                  )
                }
              />
            ) : (
              <div className={styles.empty}>
                <span>⌕</span>
                <h3>{t.noRuns}</h3>
                <p>{t.noRunsHint}</p>
              </div>
            )}
          </section>
          <footer className={styles.footer}>
            <span>
              {t.saved} · {dateText(data.updatedAt)}
            </span>
            <span>
              {t.revision} {data.revision}
            </span>
          </footer>
        </main>
      </div>
      {source && (
        <Modal title={source.title} onClose={() => setSelectedSource(null)}>
          <div className={styles.dialog}>
            <div className={styles.sectionHeading}>
              <span className={styles.badge}>{t.sourceKinds[source.kind]}</span>
              <button
                onClick={() => setSelectedSource(null)}
                aria-label={t.close}
              >
                ×
              </button>
            </div>
            <h2>{source.title}</h2>
            <dl>
              <dt>{t.sourceLocator}</dt>
              <dd>{source.locator || t.sourceNoLocator}</dd>
              <dt>{t.sourceObserved}</dt>
              <dd>{dateText(source.observedAt)}</dd>
              {source.independenceGroup && (
                <>
                  <dt>{t.sourceChain}</dt>
                  <dd>{source.independenceGroup}</dd>
                </>
              )}
            </dl>
            <h3>{t.sourceExcerpt}</h3>
            <blockquote>{source.excerpt || t.sourceNoExcerpt}</blockquote>
            <p className={styles.hint}>{t.sourceQuoteHint}</p>
            {source.url && (
              <a
                className={styles.secondary}
                href={source.url}
                target="_blank"
                rel="noreferrer noopener"
              >
                {t.visitSource} ↗
              </a>
            )}
          </div>
        </Modal>
      )}
      {sourceFormOpen && (
        <Modal
          title={t.addSource}
          onClose={() => setSourceFormOpen(false)}
          busy={busy}
        >
          <form onSubmit={addSource} className={styles.dialog}>
            <h2>{t.addSource}</h2>
            <p className={styles.hint}>{t.sourceFormHint}</p>
            {dialogError && (
              <p role="alert" className={styles.errorText}>
                {dialogError}
              </p>
            )}
            <label>
              {t.sourceTitle}
              <input
                name="title"
                maxLength={1000}
                required
                autoFocus
                disabled={busy}
              />
            </label>
            <label>
              {t.sourceKind}
              <select name="kind" defaultValue="document" disabled={busy}>
                {(Object.keys(t.sourceKinds) as PrivateSource["kind"][]).map(
                  (kind) => (
                    <option value={kind} key={kind}>
                      {t.sourceKinds[kind]}
                    </option>
                  ),
                )}
              </select>
            </label>
            <label>
              {t.sourceUrl}
              <input name="url" type="url" maxLength={3000} disabled={busy} />
            </label>
            <label>
              {t.sourceLocator}
              <input
                name="locator"
                maxLength={30000}
                required
                disabled={busy}
              />
            </label>
            <label>
              {t.sourceExcerpt}
              <textarea
                name="excerpt"
                rows={7}
                maxLength={30000}
                required
                disabled={busy}
              />
            </label>
            <div className={styles.actions}>
              <button className={styles.primary} disabled={busy}>
                {t.sourceSave}
              </button>
              <button
                type="button"
                className={styles.secondary}
                onClick={() => setSourceFormOpen(false)}
                disabled={busy}
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
          busy={busy}
        >
          <div className={styles.dialog}>
            <h2>{t.import}</h2>
            <p className={styles.hint}>{t.importHint}</p>
            {dialogError && (
              <p role="alert" className={styles.errorText}>
                {dialogError}
              </p>
            )}
            <form className={styles.dialog} onSubmit={checkImport}>
              <label>
                {t.importFile}
                <input
                  type="file"
                  name="backup"
                  accept="application/json,.json"
                  required
                  disabled={busy}
                  onChange={() => {
                    importCheckId.current += 1;
                    setStagedImport(null);
                  }}
                />
              </label>
              <button className={styles.secondary} disabled={busy}>
                {t.checkImport}
              </button>
            </form>
            {stagedImport && (
              <div className={styles.importPreview}>
                <p>{t.importReady}</p>
                <strong>{stagedImport.title}</strong>
                <p>
                  {t.revision} {stagedImport.revision} ·{" "}
                  {dateText(stagedImport.updatedAt)}
                </p>
                <button
                  className={styles.primary}
                  disabled={busy || active}
                  onClick={async () => {
                    const value = await mutate("import", {
                      expectedRevision: data.revision,
                      case: stagedImport,
                    });
                    if (value) {
                      setQuestion(value.question);
                      setSourceIds(value.sources.map((item) => item.id));
                      setImportOpen(false);
                      setStagedImport(null);
                      setSelectedRun(null);
                    }
                  }}
                >
                  {t.importConfirm}
                </button>
              </div>
            )}
            <button
              className={styles.secondary}
              onClick={() => setImportOpen(false)}
              disabled={busy}
            >
              {t.cancel}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function RunView({
  run,
  data,
  onOpenSource,
  onReview,
  busy,
}: {
  run: AIRun;
  data: PrivateCase;
  onOpenSource: (id: string) => void;
  busy: boolean;
  onReview: (
    id: string,
    decision: "accepted" | "rejected",
    reason: string,
  ) => Promise<boolean>;
}) {
  const result = run.result;
  return (
    <article className={styles.run} data-testid={`private-run-${run.id}`}>
      <div className={styles.runHeading}>
        <span
          className={`${styles.runStatus} ${isActive(run) ? styles.running : ""}`}
        >
          {isActive(run) && <i />}
          {t.runStates[run.status]}
        </span>
        <span>{t.modes[run.mode]}</span>
      </div>
      <h3>{run.question}</h3>
      <dl className={styles.runMeta}>
        <div>
          <dt>{t.provider}</dt>
          <dd>{run.provider}</dd>
        </div>
        <div>
          <dt>{t.model}</dt>
          <dd>{run.model || t.modelUnknown}</dd>
        </div>
        {run.methodology && (
          <div>
            <dt>{t.methodology}</dt>
            <dd>
              {run.methodology.name} · {run.methodology.version}
            </dd>
          </div>
        )}
        <div>
          <dt>{t.started}</dt>
          <dd>{dateText(run.startedAt)}</dd>
        </div>
        {run.completedAt && (
          <div>
            <dt>{t.finished}</dt>
            <dd>{dateText(run.completedAt)}</dd>
          </div>
        )}
      </dl>
      <details className={styles.runSources}>
        <summary>
          {t.usedSources} · {run.sourceIds.length}
        </summary>
        <SourceLinks
          ids={run.sourceIds}
          sources={data.sources}
          onOpen={onOpenSource}
        />
      </details>
      {isActive(run) && (
        <p role="status" className={styles.progress}>
          {t.waiting}
        </p>
      )}
      {!isActive(run) && !result && (
        <div className={styles.runFailure}>
          <p>{t.stopped}</p>
          {run.error && <p>{t.errors[run.error] ?? run.error}</p>}
        </div>
      )}
      {result && (
        <>
          <section className={styles.summary}>
            <p className={styles.eyebrow}>{t.result}</p>
            <p>{result.summary}</p>
          </section>
          <div className={styles.findingsGrid}>
            <section>
              <h4>{t.observations}</h4>
              {result.observations.length ? (
                result.observations.map((item, index) => (
                  <article className={styles.finding} key={index}>
                    <p>{item.text}</p>
                    <SourceLinks
                      ids={item.sourceIds}
                      sources={data.sources}
                      onOpen={onOpenSource}
                    />
                  </article>
                ))
              ) : (
                <p className={styles.hint}>{t.noObservations}</p>
              )}
            </section>
            <section>
              <h4>{t.gaps}</h4>
              {result.gaps.length ? (
                result.gaps.map((item, index) => (
                  <article className={styles.gap} key={index}>
                    <strong>{item.question}</strong>
                    <p>{item.why}</p>
                  </article>
                ))
              ) : (
                <p className={styles.hint}>{t.noGaps}</p>
              )}
            </section>
          </div>
          <section className={styles.nextSteps}>
            <h4>{t.nextSteps}</h4>
            {result.nextSteps.length ? (
              <ol>
                {result.nextSteps.map((item, index) => (
                  <li key={index}>
                    <strong>{item.title}</strong>
                    <p>{item.detail}</p>
                    <SourceLinks
                      ids={item.sourceIds}
                      sources={data.sources}
                      onOpen={onOpenSource}
                    />
                  </li>
                ))}
              </ol>
            ) : (
              <p className={styles.hint}>{t.noNextSteps}</p>
            )}
          </section>
          <section className={styles.proposals}>
            <h4>{t.proposals}</h4>
            <p className={styles.hint}>{t.proposalsHint}</p>
            {result.proposals.length ? (
              result.proposals.map((proposal) => (
                <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  run={run}
                  data={data}
                  onOpenSource={onOpenSource}
                  onReview={onReview}
                  busy={busy}
                />
              ))
            ) : (
              <p className={styles.hint}>{t.noProposals}</p>
            )}
          </section>
        </>
      )}
    </article>
  );
}

function ProposalCard({
  proposal,
  run,
  data,
  onOpenSource,
  onReview,
  busy,
}: {
  proposal: Proposal;
  run: AIRun;
  data: PrivateCase;
  onOpenSource: (id: string) => void;
  onReview: (
    id: string,
    decision: "accepted" | "rejected",
    reason: string,
  ) => Promise<boolean>;
  busy: boolean;
}) {
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const lastReview = data.reviews
    .filter(
      (review) => review.runId === run.id && review.proposalId === proposal.id,
    )
    .at(-1);
  return (
    <article
      className={styles.proposal}
      data-testid={`private-proposal-${proposal.id}`}
    >
      <div className={styles.proposalTags}>
        <span className={styles.badge}>{t.proposalKinds[proposal.kind]}</span>
        <span className={styles.evidence}>
          {t.evidenceStatuses[proposal.evidenceStatus]}
        </span>
        <span className={styles.badge}>
          {t.workflowStatuses[proposal.workflowStatus]}
        </span>
      </div>
      <h5>{proposal.text}</h5>
      <p>{proposal.rationale}</p>
      <SourceLinks
        ids={proposal.sourceIds}
        sources={data.sources}
        onOpen={onOpenSource}
      />
      {lastReview && (
        <div className={styles.lastReview}>
          <small>
            {t.reviewHistory} · {dateText(lastReview.createdAt)}
          </small>
          <p>{lastReview.reason}</p>
        </div>
      )}
      {proposal.workflowStatus === "proposed" && (
        <form
          onSubmit={async (event) => {
            event.preventDefault();
            const button = (event.nativeEvent as SubmitEvent)
              .submitter as HTMLButtonElement | null;
            const decision =
              button?.value === "rejected" ? "rejected" : "accepted";
            if (await onReview(proposal.id, decision, reason.trim())) {
              setReason("");
              setMessage(t.reviewSaved);
            }
          }}
        >
          <label>
            {t.reason}
            <textarea
              required
              rows={2}
              maxLength={30000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={busy}
            />
          </label>
          <div className={styles.actions}>
            <button
              className={styles.primary}
              type="submit"
              value="accepted"
              disabled={busy || !reason.trim()}
            >
              {t.accept}
            </button>
            <button
              className={styles.secondary}
              type="submit"
              value="rejected"
              disabled={busy || !reason.trim()}
            >
              {t.reject}
            </button>
          </div>
        </form>
      )}
      <p className={styles.reviewMessage} role="status">
        {message}
      </p>
    </article>
  );
}
