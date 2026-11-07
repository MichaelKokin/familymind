"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, Controls, MarkerType, ReactFlow, applyNodeChanges, type Edge, type OnNodesChange, type ReactFlowInstance } from "@xyflow/react";
import type { ResearchPhoto } from "@/private-case/research-model";
import type { AncestryBranch } from "@/private-case/ancestry-layout";
import { composeSpace, findNodeId, layoutSpace, materialNodeId, type ComposedPerson, type SpaceNode } from "@/private-case/space-layout";
import { guideCandidates, suggestNextStep, type GuideStep } from "@/private-case/space-guide";
import type { SpaceAction } from "@/private-case/space-logic";
import { exploreText as t } from "@/i18n/explore";
import { spaceText as s } from "@/i18n/space";
import { canvasAriaLabels } from "@/i18n/canvas";
import Modal from "./Modal";
import SpaceAssistant from "./space/SpaceAssistant";
import AddMenu, { type AddOption } from "./space/AddMenu";
import { spaceNodeTypes, type SpaceFlowNode } from "./space/SpaceCards";
import { FindPanel, LeadPanel, MaterialPanel, OverviewPanel, PersonPanel, SourceCard, birthPlace, dateLabel, pathLabel, relationStatus, roleLabel, statusLabel, type PanelContext } from "./space/SpacePanel";
import { AttachOriginalDialog, DecideFindDialog, FindDialog, ImportDialog, LeadDialog, LeadOutcomeDialog, MaterialDialog, PersonDialog, RelationshipDialog, type MaterialDraft } from "./space/SpaceForms";
import { mediaUrl, spaceApi, spaceErrorText, SpaceRequestError, template, type MaterialFile, type SpaceDialog, type SpaceSelection, type SpaceState } from "./space/space-client";
import styles from "@/app/case/explore/space.module.css";

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SpaceWorkspace({ initial, onLocked }: { initial: SpaceState; onLocked: () => void }) {
  const [state, setState] = useState<SpaceState>(initial);
  const latest = useRef<SpaceState>(initial);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const [busy, setBusy] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "saving" | "error">("saved");
  const [error, setError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const [dialog, setDialog] = useState<SpaceDialog>(null);
  const { space, snapshot } = state;
  const composition = useMemo(() => composeSpace(snapshot, space), [snapshot, space]);
  const layout = useMemo(() => layoutSpace(composition, space.layout), [composition, space.layout]);
  const [selection, setSelection] = useState<SpaceSelection>(() => (composition.rootPersonId ? { kind: "person", id: composition.rootPersonId, nodeId: null } : null));
  const [branch, setBranch] = useState<"all" | AncestryBranch>("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"map" | "list">("map");
  const [chatOpen, setChatOpen] = useState(false);
  const [chatSeed, setChatSeed] = useState({ key: 0, question: "" });
  const [photo, setPhoto] = useState<ResearchPhoto | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [relationId, setRelationId] = useState<string | null>(null);
  const [calloutHidden, setCalloutHidden] = useState(false);
  const [recentId, setRecentId] = useState<string | null>(null);
  const flow = useRef<ReactFlowInstance<SpaceFlowNode> | null>(null);
  const moreMenu = useRef<HTMLDetailsElement>(null);
  const [pendingFocus, setPendingFocus] = useState<{ x: number; y: number } | null>(null);
  const pendingFocusRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => { pendingFocusRef.current = pendingFocus; }, [pendingFocus]);
  useEffect(() => {
    if (!pendingFocus || view !== "map") return;
    const frame = requestAnimationFrame(() => {
      if (flow.current) { void flow.current.setCenter(pendingFocus.x, pendingFocus.y, { zoom: 0.9, duration: 250 }); setPendingFocus(null); }
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingFocus, view]);
  useEffect(() => {
    if (!recentId) return;
    const timer = setTimeout(() => setRecentId(null), 4000);
    return () => clearTimeout(timer);
  }, [recentId]);

  const accept = useCallback((next: SpaceState) => {
    if (next.space.revision < latest.current.space.revision) return false;
    latest.current = next;
    setState(next);
    return true;
  }, []);
  const run = useCallback(<T,>(task: (revision: number) => Promise<T>): Promise<T | null> => {
    const promise = queue.current.then(async () => {
      setBusy(true);
      setSaveState("saving");
      setError("");
      setDialogError("");
      try {
        const result = await task(latest.current.space.revision);
        setSaveState("saved");
        return result;
      } catch (failure) {
        const message = spaceErrorText(failure);
        setError(message);
        setDialogError(message);
        setSaveState("error");
        if (failure instanceof SpaceRequestError && failure.status === 401) onLocked();
        else if (failure instanceof SpaceRequestError && failure.code === "STALE_REVISION") {
          try { accept(await spaceApi<SpaceState>("")); } catch { /* keep the visible error */ }
        }
        return null;
      } finally {
        setBusy(false);
      }
    });
    queue.current = promise.catch(() => undefined);
    return promise;
  }, [accept, onLocked]);
  const mutate = useCallback((action: SpaceAction) => run(async (revision) => { const next = await spaceApi<SpaceState>("/mutate", { expectedRevision: revision, action }); accept(next); return next; }), [run, accept]);
  const createMaterial = (draft: MaterialDraft) => run(async (revision) => { const next = await spaceApi<SpaceState>("/material", { expectedRevision: revision, ...draft }, 60000); accept(next); return next; });
  const attachOriginal = (materialId: string, file: MaterialFile) => run(async (revision) => { const next = await spaceApi<SpaceState>("/material", { expectedRevision: revision, materialId, file }, 60000); accept(next); return next; });
  const importBundle = (bundle: unknown) => run(async (revision) => { const next = await spaceApi<SpaceState>("/import", { expectedRevision: revision, bundle }, 120000); accept(next); return next; });
  const exportBundle = () => run(async () => { const bundle = await spaceApi<unknown>("/export", {}, 120000); download(JSON.stringify(bundle, null, 2), "familymind-private-space.json"); return bundle; });
  const reload = () => run(async () => { const next = await spaceApi<SpaceState>(""); accept(next); return next; });

  const focusPoint = (point: { x: number; y: number }) => { setPendingFocus(point); setView("map"); setQuery(""); setBranch("all"); };
  const centerNode = (node: SpaceNode | undefined) => { if (node) focusPoint({ x: node.x + node.width / 2, y: node.y + node.height / 2 }); };
  const personNode = (id: string, nodeId?: string | null) => layout.nodes.find((item) => item.id === nodeId && item.entityId === id) ?? layout.nodes.find((item) => item.kind === "person" && item.entityId === id);
  const resetModals = () => { setSourceId(null); setRelationId(null); setPhoto(null); };
  const selectPerson = (id: string, nodeId?: string | null, center = false) => { const node = personNode(id, nodeId); setSelection({ kind: "person", id, nodeId: node?.id ?? null }); resetModals(); if (center) centerNode(node); };
  const selectMaterial = (id: string, center = false) => { setSelection({ kind: "material", id }); resetModals(); if (center) centerNode(layout.nodes.find((item) => item.id === materialNodeId(id))); };
  const selectFind = (id: string, center = false) => { setSelection({ kind: "find", id }); resetModals(); if (center) centerNode(layout.nodes.find((item) => item.id === findNodeId(id))); };
  const selectLead = (id: string) => { setSelection({ kind: "lead", id }); resetModals(); };
  const focusCreated = (next: SpaceState, kind: "person" | "material" | "find" | "lead", id: string) => {
    const nextLayout = layoutSpace(composeSpace(next.snapshot, next.space), next.space.layout);
    const node = kind === "person" ? nextLayout.nodes.find((item) => item.kind === "person" && item.entityId === id) : kind === "material" ? nextLayout.nodes.find((item) => item.id === materialNodeId(id)) : kind === "find" ? nextLayout.nodes.find((item) => item.id === findNodeId(id)) : undefined;
    setSelection(kind === "person" ? { kind, id, nodeId: node?.id ?? null } : { kind, id });
    if (node) { setRecentId(node.id); focusPoint({ x: node.x + node.width / 2, y: node.y + node.height / 2 }); }
  };

  const personName = (id: string) => composition.people.find((person) => person.id === id)?.name ?? "";
  const selectedPerson = selection?.kind === "person" ? composition.people.find((person) => person.id === selection.id) ?? null : null;
  const selectedMaterial = selection?.kind === "material" ? composition.materials.find((material) => material.id === selection.id) ?? null : null;
  const selectedFind = selection?.kind === "find" ? composition.finds.find((find) => find.id === selection.id) ?? null : null;
  const selectedLead = selection?.kind === "lead" ? composition.leads.find((lead) => lead.id === selection.id) ?? null : null;
  const selectedNode = selection?.kind === "person" ? personNode(selection.id, selection.nodeId) ?? null : selection?.kind === "material" ? layout.nodes.find((node) => node.id === materialNodeId(selection.id)) ?? null : selection?.kind === "find" ? layout.nodes.find((node) => node.id === findNodeId(selection.id)) ?? null : null;
  const materialsOf = (personId: string) => composition.materials.filter((material) => material.personIds.includes(personId));
  const relationCaption = (person: ComposedPerson, node: SpaceNode) => {
    if (node.occurrence) return pathLabel(node.occurrence);
    const relation = composition.relationships.find((item) => item.to === person.id && item.kind === "parent_child") ?? composition.relationships.find((item) => item.from === person.id || item.to === person.id);
    if (!relation) return t.notConnected;
    const other = relation.from === person.id ? relation.to : relation.from;
    const caption = relation.kind === "parent_child" ? (relation.to === person.id ? s.childCaption : roleLabel(relation.parentRole ?? "parent")) : relation.kind === "partner" ? s.partnerCaption : relation.label;
    return `${caption} · ${personName(other)}`;
  };
  const personImage = (person: ComposedPerson) => {
    const picture = person.snapshot ? snapshot?.photos.find((item) => person.snapshot!.photoIds.includes(item.id)) : undefined;
    if (picture) return picture.dataUrl;
    const material = materialsOf(person.id).find((item) => item.original?.mime.startsWith("image/"));
    return material ? mediaUrl(material.id) : undefined;
  };

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const personMatches = (person: ComposedPerson) => !normalizedQuery || [person.name, person.dateText, person.snapshot?.birthPlace, person.snapshot?.relation, person.record?.notes, ...(person.snapshot?.residencePlaces ?? []), ...(person.snapshot?.placeFacts?.map((fact) => fact.place) ?? [])].filter(Boolean).join(" ").toLocaleLowerCase().includes(normalizedQuery);
  const branchMatches = (node: SpaceNode) => branch === "all" || node.branch === branch || node.branch === "owner";
  const personNodes = layout.nodes.filter((node) => node.kind === "person");
  const matchingPeople = composition.people.filter((person) => personMatches(person) && (branch === "all" || personNodes.some((node) => node.entityId === person.id && branchMatches(node))));
  const matchingIds = new Set(matchingPeople.map((person) => person.id));
  const matchNodes = personNodes.filter((node) => branchMatches(node) && matchingIds.has(node.entityId));
  const visiblePersonNodes = normalizedQuery
    ? personNodes.filter((node) => matchNodes.some((match) => node.id === match.id || Boolean(node.occurrence && match.occurrence && (!node.occurrence.path.length || (node.occurrence.path.length <= match.occurrence.path.length && node.occurrence.path.every((step, index) => step.relationshipId === match.occurrence!.path[index]?.relationshipId))))))
    : personNodes.filter(branchMatches);
  const visibleIds = new Set(visiblePersonNodes.map((node) => node.id));
  const attachedVisible = (personIds: string[], haystack: string) => {
    const linked = personIds.map((id) => layout.primaryNodeId.get(id)).filter((id): id is string => Boolean(id));
    const anchorVisible = linked.some((id) => visibleIds.has(id)) || (!linked.length && branch === "all");
    return normalizedQuery ? anchorVisible || haystack.toLocaleLowerCase().includes(normalizedQuery) : anchorVisible;
  };
  const visibleMaterialNodes = layout.nodes.filter((node) => node.kind === "material").filter((node) => { const material = composition.materials.find((item) => item.id === node.entityId); return Boolean(material) && attachedVisible(material!.personIds, `${material!.title} ${material!.text} ${material!.provenance}`); });
  const visibleFindNodes = layout.nodes.filter((node) => node.kind === "find").filter((node) => { const find = composition.finds.find((item) => item.id === node.entityId); return Boolean(find) && attachedVisible(find!.personIds, `${find!.title} ${find!.why} ${find!.source.title}`); });
  for (const node of [...visibleMaterialNodes, ...visibleFindNodes]) visibleIds.add(node.id);
  const matchingMaterials = composition.materials.filter((material) => !normalizedQuery || `${material.title} ${material.text} ${material.provenance}`.toLocaleLowerCase().includes(normalizedQuery));

  const flowNodes = useMemo<SpaceFlowNode[]>(() => [...visiblePersonNodes, ...visibleMaterialNodes, ...visibleFindNodes].map((node) => {
    const base = { id: node.id, position: { x: node.x, y: node.y }, width: node.width, height: node.height, selected: node.id === selectedNode?.id };
    if (node.kind === "person") {
      const person = composition.people.find((item) => item.id === node.entityId)!;
      return { ...base, type: "person", data: { card: "person", title: person.name, dates: dateLabel(person), place: birthPlace(person.snapshot), status: statusLabel(person), path: relationCaption(person, node), branch: node.branch, image: personImage(person), repeated: node.occurrence?.repeated ?? false, origin: person.origin, materialCount: materialsOf(person.id).length, isNew: node.id === recentId, onActivate: () => selectPerson(person.id, node.id) } };
    }
    if (node.kind === "material") {
      const material = composition.materials.find((item) => item.id === node.entityId)!;
      return { ...base, type: "material", data: { card: "material", title: material.title, kind: material.kind, kindLabel: s.materialKinds[material.kind], image: material.original?.mime.startsWith("image/") ? mediaUrl(material.id) : undefined, caption: material.dateText || material.provenance || material.text.slice(0, 80), people: material.personIds.map(personName).filter(Boolean).join(", "), external: material.origin === "external_find", isNew: node.id === recentId, onActivate: () => selectMaterial(material.id) } };
    }
    const find = composition.finds.find((item) => item.id === node.entityId)!;
    return { ...base, type: "find", data: { card: "find", title: find.title, about: find.personIds.map(personName).filter(Boolean).join(", "), source: find.source.title, why: find.why, isNew: node.id === recentId, onActivate: () => selectFind(find.id) } };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [layout, composition, snapshot, selectedNode?.id, branch, normalizedQuery, recentId]);
  const [nodes, setNodes] = useState<SpaceFlowNode[]>(flowNodes);
  const [previousFlowNodes, setPreviousFlowNodes] = useState(flowNodes);
  if (previousFlowNodes !== flowNodes) { setPreviousFlowNodes(flowNodes); setNodes(flowNodes); }
  const onNodesChange: OnNodesChange<SpaceFlowNode> = useCallback((changes) => setNodes((current) => applyNodeChanges(changes, current)), []);
  const edges: Edge[] = layout.edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target)).map((edge) => {
    if (edge.kind === "material" || edge.kind === "find") return { id: edge.id, source: edge.source, target: edge.target, sourceHandle: "out", targetHandle: "side-in", type: "smoothstep", focusable: false, style: { stroke: edge.kind === "find" ? "#c9933d" : "#c2ad7a", strokeWidth: 1.5, strokeDasharray: "2 4" }, data: { materialId: edge.kind === "material" ? edge.materialId : null, findId: edge.kind === "find" ? edge.materialId : null } };
    const sourceNode = layout.nodes.find((node) => node.id === edge.source);
    const color = edge.kind === "parent_child" ? (sourceNode?.branch === "paternal" ? "#5b7a8c" : sourceNode?.branch === "maternal" ? "#a67b72" : "#8a8578") : edge.kind === "partner" ? "#8c7a5a" : "#9a948a";
    const label = edge.kind === "parent_child" ? roleLabel(edge.role ?? "parent") : edge.kind === "partner" ? (edge.label || s.relationKinds.partner) : edge.label;
    return { id: edge.id, source: edge.source, target: edge.target, sourceHandle: edge.kind === "parent_child" ? "child" : "side-out", targetHandle: edge.kind === "parent_child" ? "parents" : "side-in", label, type: "smoothstep", style: { stroke: color, strokeWidth: 2, strokeDasharray: edge.kind === "parent_child" ? "6 4" : "3 5" }, ...(edge.kind === "parent_child" ? { markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 } } : {}), labelStyle: { fill: color, fontSize: 12, fontWeight: 600 }, labelBgStyle: { fill: "#fbf9f3", fillOpacity: 1 }, labelBgPadding: [7, 4] as [number, number], ariaLabel: `${label}: ${relationStatus(edge)}`, data: { relationshipId: edge.relationshipId } };
  });
  const persistPositions = (moved: Array<{ id: string; position: { x: number; y: number } }>) => {
    const positions: Record<string, { x: number; y: number }> = {};
    for (const item of moved) {
      const current = layout.nodes.find((node) => node.id === item.id);
      const x = Math.round(item.position.x), y = Math.round(item.position.y);
      if (!current || (current.manual && Math.round(current.x) === x && Math.round(current.y) === y)) continue;
      positions[item.id] = { x, y };
    }
    if (Object.keys(positions).length) void mutate({ action: "layout", positions });
  };
  const initialFocusIds = layout.nodes.filter((node) => node.occurrence && node.depth !== null && node.depth <= 1).map((node) => ({ id: node.id }));
  const focusOwner = () => {
    if (!composition.rootPersonId) return;
    selectPerson(composition.rootPersonId); setView("map"); setQuery(""); setBranch("all");
    requestAnimationFrame(() => { void flow.current?.fitView({ nodes: initialFocusIds, padding: .14, maxZoom: .92, duration: 250 }); });
  };
  useEffect(() => {
    if (!query.trim() && branch === "all") return;
    const frame = requestAnimationFrame(() => { void flow.current?.fitView({ padding: .16, maxZoom: .92, duration: 200 }); });
    return () => cancelAnimationFrame(frame);
  }, [query, branch]);

  const guideSelection = useMemo(() => (selection ? { kind: selection.kind, id: selection.id } : null), [selection]);
  const guideStep = useMemo(() => suggestNextStep(composition, guideSelection, space.guide.dismissed), [composition, guideSelection, space.guide.dismissed]);
  const guideOthers = useMemo(() => { const skipped = new Set(space.guide.dismissed); return guideCandidates(composition, guideSelection).filter((step) => !skipped.has(step.key) && step.key !== guideStep?.key).slice(0, 2); }, [composition, guideSelection, space.guide.dismissed, guideStep?.key]);
  const research = { open: composition.leads.filter((lead) => ["open", "needs_detail", "candidate"].includes(lead.status)).length, pending: composition.finds.filter((find) => find.status === "candidate").length };
  const askAssistant = (name: string) => { setChatOpen(true); setChatSeed((seed) => ({ key: seed.key + 1, question: template(s.askQuestion, { name }) })); };
  const actGuide = (step: GuideStep) => {
    if (step.action === "set_owner") setDialog({ kind: "person", anchorId: null, newPersonIs: null, editId: null });
    else if (step.action === "add_first_person" || step.action === "add_parent") setDialog({ kind: "person", anchorId: step.targetId, newPersonIs: "parent", editId: null });
    else if (step.action === "add_material") setDialog({ kind: "material", personIds: step.targetId ? [step.targetId] : [], editId: null, preset: "photo" });
    else if (step.action === "link_material") setDialog({ kind: "material", personIds: [], editId: step.targetId, preset: null });
    else if (step.action === "add_lead") setDialog({ kind: "lead", personId: step.targetId, editId: null, question: "" });
    else if (step.action === "review_find" && step.targetId) selectFind(step.targetId, true);
    else if (step.action === "lead_detail" && step.targetId) { selectLead(step.targetId); setDialog({ kind: "lead", personId: null, editId: step.targetId, question: "" }); }
    else askAssistant(step.personName);
  };
  const onAdd = (option: AddOption) => {
    const anchor = selectedPerson?.id ?? composition.rootPersonId;
    if (option === "parent" || option === "child" || option === "partner" || option === "other") setDialog({ kind: "person", anchorId: anchor, newPersonIs: option, editId: null });
    else if (option === "relationship") setDialog({ kind: "relationship", editId: null, fromId: anchor });
    else if (option === "lead") setDialog({ kind: "lead", personId: anchor, editId: null, question: "" });
    else setDialog({ kind: "material", personIds: anchor ? [anchor] : [], editId: null, preset: option });
  };
  const submitAction = async (action: SpaceAction): Promise<boolean> => {
    const next = await mutate(action);
    if (!next) return false;
    setDialog(null);
    if (next.created?.personId) focusCreated(next, "person", next.created.personId);
    else if (next.created?.findId) focusCreated(next, "find", next.created.findId);
    else if (next.created?.materialId) focusCreated(next, "material", next.created.materialId);
    else if (next.created?.leadId) focusCreated(next, "lead", next.created.leadId);
    return true;
  };
  const submitMaterial = async (draft: MaterialDraft): Promise<boolean> => { const next = await createMaterial(draft); if (!next) return false; setDialog(null); if (next.created?.materialId) focusCreated(next, "material", next.created.materialId); return true; };
  const submitAttach = async (materialId: string, file: MaterialFile): Promise<boolean> => { const next = await attachOriginal(materialId, file); if (!next) return false; setDialog(null); return true; };
  const submitImport = async (bundle: unknown): Promise<boolean> => { const next = await importBundle(bundle); if (!next) return false; setDialog(null); return true; };
  const openSource = (id: string) => { setPhoto(null); setRelationId(null); setSourceId(id); };
  const currentSource = snapshot?.sources.find((source) => source.id === sourceId);
  const currentRelation = composition.relationships.find((relation) => relation.id === relationId);
  const photoSource = photo && snapshot?.sources.find((source) => source.id === photo.sourceId);
  const removedCount = composition.removed.people.length + composition.removed.materials.length + composition.removed.relationships.length;
  const title = snapshot?.title ?? s.spaceTitle;
  const ownerName = snapshot?.owner.name ?? (composition.rootPersonId ? personName(composition.rootPersonId) : "");
  const firstExperience = Boolean(composition.rootPersonId) && !space.people.length && !space.materials.length && !calloutHidden;
  const ctx: PanelContext = { composition, snapshot, space, layout, busy, ownerName, personName, relationCaption, selectPerson, selectMaterial, selectFind, selectLead, openDialog: setDialog, mutate, openSource, openPhoto: setPhoto, openRelation: setRelationId };
  const closeMore = () => { if (moreMenu.current) moreMenu.current.open = false; };

  return <div className={styles.root} data-testid="private-explore">
    <header className={styles.header}>
      <a href="/case" className={styles.brand}>{t.brand}</a>
      <div className={styles.project}><h1>{title}</h1><span>{ownerName}</span></div>
      <nav className={styles.nav}><a href="/case/members">{t.memberCabinet}</a><a href="/case">{t.back}</a><a href="/api/private/report" target="_blank" rel="noopener noreferrer">{t.report} ↗</a></nav>
    </header>
    {error && <div className={`${styles.banner} ${styles.bannerError}`} role="alert"><span>{error}</span><button type="button" onClick={() => { void reload(); }}>{s.reload}</button><button type="button" aria-label={s.dismiss} onClick={() => setError("")}>×</button></div>}
    {state.warnings.snapshotChanged && <p role="status" className={`${styles.banner} ${styles.bannerWarning}`}>{s.snapshotChanged}</p>}
    {(state.warnings.dangling.relationships.length > 0 || state.warnings.dangling.materials.length > 0 || state.warnings.dangling.leads.length > 0 || state.warnings.dangling.finds.length > 0) && <p role="status" className={`${styles.banner} ${styles.bannerWarning}`}>{s.dangling}</p>}
    <div className={styles.stage}>
      <div className={styles.canvasColumn}>
        <div className={styles.toolbar}>
          <div className={styles.viewTabs}><button type="button" className={view === "map" ? styles.active : ""} onClick={() => setView("map")}>{s.viewMap}</button><button type="button" className={view === "list" ? styles.active : ""} onClick={() => setView("list")}>{t.list}</button></div>
          <label className={styles.searchField}><span aria-hidden="true">⌕</span><input aria-label={t.search} placeholder={s.searchPlaceholder} value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <select className={styles.toolbarSelect} aria-label={t.branch} value={branch} onChange={(event) => setBranch(event.target.value as typeof branch)}><option value="all">{t.all}</option><option value="paternal">{t.paternal}</option><option value="maternal">{t.maternal}</option><option value="unspecified">{t.unspecified}</option></select>
          <span className={styles.toolbarSpacer} />
          <button type="button" className={styles.toolbarSelect} onClick={focusOwner} disabled={!composition.rootPersonId}>{t.ownerFocus}</button>
          <button type="button" className={styles.toolbarSelect} onClick={() => { void flow.current?.fitView({ padding: .1, maxZoom: .92, duration: 250 }); }} disabled={view !== "map" || !nodes.length}>{t.allGenerations}</button>
          <details ref={moreMenu} className={styles.menu}><summary>{s.more}</summary><div className={styles.menuList}><button type="button" disabled={busy} onClick={() => { closeMore(); void exportBundle(); }}>{s.exportSpace}</button><button type="button" disabled={busy} onClick={() => { closeMore(); setDialog({ kind: "import" }); }}>{s.importSpace}</button><button type="button" onClick={() => { closeMore(); setDialog({ kind: "removed" }); }}>{s.removedCards}{removedCount ? ` · ${removedCount}` : ""}</button></div></details>
        </div>
        {view === "map" ? <div className={styles.canvas} data-testid="research-map" onKeyUp={(event) => {
          if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) && event.target instanceof HTMLElement && event.target.closest(".react-flow__node")) persistPositions(nodes.filter((node) => node.selected || node.id === selectedNode?.id));
        }}>
          {!flowNodes.length ? <div className={styles.mapEmpty}><h2>{!composition.rootPersonId ? t.missingRoot : t.noMapMatches}</h2><p>{!composition.rootPersonId ? s.guide.set_owner.detail : t.unlinkedHint}</p><div className={styles.actionsRow}>{!composition.rootPersonId && <button type="button" className={styles.primary} onClick={() => setDialog({ kind: "person", anchorId: null, newPersonIs: null, editId: null })}>{s.guide.set_owner.title}</button>}<button type="button" className={styles.secondary} onClick={() => setView("list")}>{t.showList}</button></div></div>
            : <ReactFlow nodes={nodes} edges={edges} nodeTypes={spaceNodeTypes} onNodesChange={onNodesChange} nodesDraggable nodesConnectable={false} deleteKeyCode={null} onInit={(instance) => { flow.current = instance; const focus = pendingFocusRef.current; if (focus) { void instance.setCenter(focus.x, focus.y, { zoom: 0.9, duration: 250 }); setPendingFocus(null); } }} onNodeClick={(_event, node) => { const item = layout.nodes.find((entry) => entry.id === node.id); if (!item) return; if (item.kind === "person") selectPerson(item.entityId, item.id); else if (item.kind === "material") selectMaterial(item.entityId); else selectFind(item.entityId); }} onNodeDragStop={(_event, node, moved) => persistPositions(moved.length ? moved : [node])} onEdgeClick={(_event, edge) => { const data = edge.data as { relationshipId?: string | null; materialId?: string | null; findId?: string | null } | undefined; if (data?.relationshipId) setRelationId(data.relationshipId); else if (data?.findId) selectFind(data.findId); else if (data?.materialId) selectMaterial(data.materialId); }} fitView fitViewOptions={{ nodes: initialFocusIds.length ? initialFocusIds : undefined, padding: .14, maxZoom: .92 }} minZoom={.05} maxZoom={1.8} ariaLabelConfig={canvasAriaLabels}><Background color="#e1dbcd" gap={24} /><Controls showInteractive={false} showFitView={false} /></ReactFlow>}
          {firstExperience && <div className={styles.callout} role="note" data-testid="first-callout"><strong>{s.calloutTitle}</strong><p>{s.calloutText}</p><button type="button" onClick={() => setCalloutHidden(true)}>{s.calloutDismiss}</button></div>}
        </div> : <div className={styles.listView}>
          <section><h2 className={`${styles.sectionTitle} ${styles.serif}`}>{s.peopleList}</h2><div className={styles.peopleList}>{matchingPeople.map((person) => { const node = personNodes.find((item) => item.entityId === person.id); return <button key={person.id} type="button" className={person.id === selectedPerson?.id ? styles.selectedList : ""} onClick={() => selectPerson(person.id, node?.id)}><strong>{person.name}</strong><span>{dateLabel(person)}</span><small>{node ? relationCaption(person, node) : t.notConnected} · {birthPlace(person.snapshot)}</small><small>{statusLabel(person)}</small></button>; })}{!matchingPeople.length && <p className={styles.muted}>{t.noResults}</p>}</div></section>
          <section className={styles.listSection}><h2 className={styles.sectionTitle}>{s.materialsList}</h2>{matchingMaterials.length ? <div className={styles.recordList}>{matchingMaterials.map((material) => <button key={material.id} type="button" className={styles.recordRow} onClick={() => selectMaterial(material.id)}>{material.original?.mime.startsWith("image/") ? <img src={mediaUrl(material.id)} alt="" loading="lazy" /> : <span className={styles.recordIcon} aria-hidden="true">▤</span>}<span><strong>{material.title}</strong><small>{s.materialKinds[material.kind]}{material.personIds.length ? ` · ${material.personIds.map(personName).join(", ")}` : ""}</small></span></button>)}</div> : <p className={styles.muted}>{s.noMaterials}</p>}</section>
        </div>}
        <SpaceAssistant step={guideStep} others={guideOthers} hasDismissed={space.guide.dismissed.length > 0} busy={busy} research={research} chatOpen={chatOpen} chatSeed={chatSeed} onToggleChat={() => setChatOpen((open) => !open)} onAct={actGuide} onSkip={(step) => { void mutate({ action: "guide_dismiss", key: step.key }); }} onReset={() => { void mutate({ action: "guide_reset" }); }} onOpenSource={openSource} onOpenSpaceRecord={(id) => { if (composition.materials.some((item) => item.id === id)) selectMaterial(id, true); else if (composition.finds.some((item) => item.id === id)) selectFind(id, true); }} />
        <AddMenu anchorName={selectedPerson?.name ?? (composition.rootPersonId ? personName(composition.rootPersonId) : "")} canRelate={composition.people.length >= 2} disabled={busy} onPick={onAdd} />
        <div className={styles.statusBar}><span>{t.connectionHint}</span><span>{s.editorHint}</span><span className={saveState === "saving" ? styles.saving : saveState === "error" ? styles.saveError : ""} role="status" data-testid="space-save-state">{saveState === "saving" ? s.saving : saveState === "error" ? s.saveFailed : s.saved} · {s.revision} {space.revision}</span></div>
        {layout.omittedCycleIds.length > 0 && <p role="status" className={`${styles.banner} ${styles.bannerWarning}`}>{t.cycleWarning}</p>}{layout.truncated && <p role="status" className={`${styles.banner} ${styles.bannerWarning}`}>{t.limitWarning}</p>}
      </div>
      <aside className={styles.panel} aria-label={t.biography} data-testid="research-inspector">
        <div className={styles.panelInner}>
          {selectedFind ? <FindPanel ctx={ctx} find={selectedFind} node={selectedNode} /> : selectedLead ? <LeadPanel ctx={ctx} lead={selectedLead} /> : selectedMaterial ? <MaterialPanel ctx={ctx} material={selectedMaterial} node={selectedNode} /> : selectedPerson ? <PersonPanel ctx={ctx} person={selectedPerson} node={selectedNode} /> : <OverviewPanel ctx={ctx} />}
        </div>
      </aside>
    </div>
    {photo && <Modal title={photo.title} onClose={() => setPhoto(null)}><div className={styles.root}><div className={styles.dialogHeader}><h2>{photo.title}</h2><button type="button" onClick={() => setPhoto(null)} aria-label={t.close}>×</button></div><div className={styles.photoDialog}><img src={photo.dataUrl} alt={photo.title} /><p>{photo.caption}</p><p className={styles.muted}>{t.photoHint}</p>{photoSource && <><div className={styles.eyebrow}>{t.photoSource}</div><SourceCard source={photoSource} /></>}<div className={styles.photoPeople}>{photo.personIds.map((id) => <button key={id} type="button" onClick={() => { selectPerson(id, undefined, true); setPhoto(null); }}>{personName(id)} →</button>)}</div></div></div></Modal>}
    {currentSource && <Modal title={currentSource.title} onClose={() => setSourceId(null)}><div className={styles.root}><div className={styles.dialogHeader}><h2>{t.origin}</h2><button type="button" onClick={() => setSourceId(null)} aria-label={t.close}>×</button></div><SourceCard source={currentSource} />{(snapshot?.photos ?? []).filter((item) => item.sourceId === currentSource.id).map((item) => <button key={item.id} type="button" className={styles.heroPhoto} onClick={() => { setSourceId(null); setPhoto(item); }} aria-label={item.title}><img src={item.dataUrl} alt="" /></button>)}</div></Modal>}
    {currentRelation && <Modal title={t.relationships} onClose={() => setRelationId(null)}><div className={styles.root}><div className={styles.dialogHeader}><h2>{currentRelation.kind === "parent_child" ? t.parentOf : currentRelation.kind === "partner" ? s.relationKinds.partner : currentRelation.label}</h2><button type="button" onClick={() => setRelationId(null)} aria-label={t.close}>×</button></div>{currentRelation.kind === "parent_child" ? <><p><strong>{roleLabel(currentRelation.parentRole ?? "parent")}:</strong> {personName(currentRelation.from)}</p><p><strong>{t.toChild}:</strong> {personName(currentRelation.to)}</p><p className={styles.muted}>{currentRelation.label}</p></> : <p>{personName(currentRelation.from)} → {personName(currentRelation.to)}</p>}<div className={styles.badge}>{relationStatus(currentRelation)}{currentRelation.origin === "space" ? ` · ${s.ownerStatement}` : ""}</div>{currentRelation.rationale && <p className={styles.muted}>{s.relationRationale}: {currentRelation.rationale}</p>}<p className={styles.muted}>{t.statusNote}</p>{(snapshot?.sources ?? []).filter((source) => currentRelation.sourceIds.includes(source.id)).map((source) => <SourceCard key={source.id} source={source} />)}{!currentRelation.sourceIds.length && currentRelation.origin === "snapshot" && <p>{t.noSources}</p>}{currentRelation.record && <div className={styles.actionsRow}><button type="button" className={styles.secondary} onClick={() => { setRelationId(null); setDialog({ kind: "relationship", editId: currentRelation.id, fromId: null }); }} disabled={busy}>{s.editRelation}</button><button type="button" className={styles.danger} onClick={() => { void mutate({ action: "remove_relationship", id: currentRelation.id }).then(() => setRelationId(null)); }} disabled={busy}>{s.removeRelation}</button></div>}</div></Modal>}
    {dialog?.kind === "person" && <PersonDialog composition={composition} anchorId={dialog.anchorId} newPersonIs={dialog.newPersonIs} edit={dialog.editId ? space.people.find((person) => person.id === dialog.editId) ?? null : null} busy={busy} error={dialogError} onSubmit={submitAction} onClose={() => setDialog(null)} />}
    {dialog?.kind === "material" && <MaterialDialog composition={composition} personIds={dialog.personIds} preset={dialog.preset} edit={dialog.editId ? space.materials.find((material) => material.id === dialog.editId) ?? null : null} busy={busy} error={dialogError} onCreate={submitMaterial} onUpdate={submitAction} onClose={() => setDialog(null)} />}
    {dialog?.kind === "attach" && space.materials.find((material) => material.id === dialog.materialId) && <AttachOriginalDialog material={space.materials.find((material) => material.id === dialog.materialId)!} busy={busy} error={dialogError} onAttach={(file) => submitAttach(dialog.materialId, file)} onClose={() => setDialog(null)} />}
    {dialog?.kind === "relationship" && <RelationshipDialog composition={composition} edit={dialog.editId ? space.relationships.find((relation) => relation.id === dialog.editId) ?? null : null} fromId={dialog.fromId} busy={busy} error={dialogError} onSubmit={submitAction} onClose={() => setDialog(null)} />}
    {dialog?.kind === "lead" && <LeadDialog composition={composition} personId={dialog.personId} initialQuestion={dialog.question} edit={dialog.editId ? space.leads.find((lead) => lead.id === dialog.editId) ?? null : null} busy={busy} error={dialogError} onSubmit={submitAction} onClose={() => setDialog(null)} />}
    {dialog?.kind === "find" && <FindDialog composition={composition} leadId={dialog.leadId} personIds={dialog.personIds} busy={busy} error={dialogError} onSubmit={submitAction} onClose={() => setDialog(null)} />}
    {dialog?.kind === "decide" && composition.finds.find((find) => find.id === dialog.findId) && <DecideFindDialog composition={composition} find={composition.finds.find((find) => find.id === dialog.findId)!} decision={dialog.decision} busy={busy} error={dialogError} onSubmit={submitAction} onClose={() => setDialog(null)} />}
    {dialog?.kind === "leadOutcome" && composition.leads.find((lead) => lead.id === dialog.leadId) && <LeadOutcomeDialog lead={composition.leads.find((lead) => lead.id === dialog.leadId)!} outcome={dialog.outcome} busy={busy} error={dialogError} onSubmit={submitAction} onClose={() => setDialog(null)} />}
    {dialog?.kind === "import" && <ImportDialog caseId={space.caseId} busy={busy} error={dialogError} onImport={submitImport} onClose={() => setDialog(null)} />}
    {dialog?.kind === "removed" && <Modal title={s.removedCards} onClose={() => setDialog(null)} busy={busy}><div className={styles.root}><div className={styles.dialogHeader}><h2>{s.removedCards}</h2><button type="button" onClick={() => setDialog(null)} aria-label={s.close}>×</button></div><p className={styles.hint}>{s.removedHint}</p>{removedCount ? <div className={styles.removedList} data-testid="removed-list">
      {composition.removed.people.map((person) => <div key={person.id}><span>{s.removedPerson}: <strong>{person.name}</strong></span><button type="button" className={styles.secondary} disabled={busy} onClick={() => { void mutate({ action: "restore_person", id: person.id }); }}>{s.restore}</button></div>)}
      {composition.removed.materials.map((material) => <div key={material.id}><span>{s.removedMaterial}: <strong>{material.title}</strong></span><button type="button" className={styles.secondary} disabled={busy} onClick={() => { void mutate({ action: "restore_material", id: material.id }); }}>{s.restore}</button></div>)}
      {composition.removed.relationships.map((relation) => <div key={relation.id}><span>{s.removedRelationship}: <strong>{s.relationKinds[relation.kind]}</strong> · {[relation.from, relation.to].map((id) => personName(id) || composition.removed.people.find((person) => person.id === id)?.name || "?").join(" → ")}</span><button type="button" className={styles.secondary} disabled={busy} onClick={() => { void mutate({ action: "restore_relationship", id: relation.id }); }}>{s.restore}</button></div>)}
    </div> : <p className={styles.muted}>{s.removedEmpty}</p>}</div></Modal>}
  </div>;
}

export default function PrivateExplore() {
  const [data, setData] = useState<SpaceState | null>(null);
  const [error, setError] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;
    const timeout = setTimeout(() => controller.abort(), 30000);
    fetch("/api/private/space", { credentials: "same-origin", cache: "no-store", signal: controller.signal }).then(async (response) => {
      if (!response.ok) { if (mounted) setError(response.status); return; }
      const next = await response.json() as SpaceState;
      if (mounted) { setData(next); setError(null); }
    }).catch(() => { if (mounted) setError(0); }).finally(() => clearTimeout(timeout));
    return () => { mounted = false; clearTimeout(timeout); controller.abort(); };
  }, [attempt]);
  if (data) return <SpaceWorkspace key={attempt} initial={data} onLocked={() => { setData(null); setError(401); }} />;
  return <div className={styles.root}><div className={styles.loading}><div className={styles.eyebrow}>{t.brand}</div><h1>{error === null ? t.loading : error === 401 || error === 403 ? t.locked : error === 404 ? t.missing : t.failed}</h1>{error !== null && <><p>{error === 401 || error === 403 ? t.lockedHint : error === 404 ? t.missingHint : t.failedHint}</p><div><a href="/case">{t.back}</a><button type="button" onClick={() => { setError(null); setAttempt((value) => value + 1); }}>{t.retry}</button></div></>}</div></div>;
}
