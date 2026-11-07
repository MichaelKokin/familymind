"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps, type ReactFlowInstance } from "@xyflow/react";
import type { PrivateResearch, ResearchPerson, ResearchPhoto } from "@/private-case/research-model";
import { ancestryLayout, ANCESTRY_CARD_HEIGHT, ANCESTRY_CARD_WIDTH, type AncestryBranch, type AncestryNode, type ParentRole } from "@/private-case/ancestry-layout";
import { exploreText as t } from "@/i18n/explore";
import { canvasAriaLabels } from "@/i18n/canvas";
import Modal from "./Modal";
import FamilyChat from "./FamilyChat";
import MemberNotes from "./MemberNotes";
import styles from "@/app/case/explore/explore.module.css";

type CardData = { title: string; dates: string; place: string; status: string; path: string; branch: AncestryBranch; image?: string; repeated: boolean; onActivate: () => void; [key: string]: unknown };
type PersonNode = Node<CardData>;
const roleLabel = (role: ParentRole) => role === "father" ? t.father : role === "mother" ? t.mother : t.parent;
const branchLabel = (branch: AncestryBranch) => branch === "paternal" ? t.paternal : branch === "maternal" ? t.maternal : branch === "owner" ? t.owner : t.unspecified;
const pathLabel = (node: AncestryNode) => node.path.length ? node.path.map(step => roleLabel(step.role)).join(" → ") : t.owner;
const birthPlace = (person: ResearchPerson) => [...new Set(person.placeFacts?.filter(fact => fact.kind === "birth").map(fact => fact.place) ?? [])].join(" / ") || person.birthPlace || t.placeUnknown;
const dateLabel = (person: ResearchPerson) => person.dates || person.birthDate || t.dateUnknown;

function ResearchCard({ data, selected }: NodeProps<PersonNode>) {
  return <div className={`${styles.card} ${styles[data.branch]} ${selected ? styles.selectedCard : ""}`}>
    <Handle id="parents" type="target" position={Position.Top} />
    <button type="button" className={styles.cardButton} onClick={data.onActivate} aria-label={`${data.title}, ${data.path}, ${data.dates}`}>
      <div className={styles.cardTop}>{data.image ? <img src={data.image} alt="" /> : <span className={styles.initial}>{data.title.slice(0, 1)}</span>}<span className={styles.cardPath} title={data.path}>{data.path}</span></div>
      <strong>{data.title}</strong><span className={styles.cardDates}>{data.dates}</span><span className={styles.cardPlace} title={data.place}>{data.place}</span>
      <span className={styles.cardStatus}>{data.status}</span>{data.repeated && <span className={styles.shared} title={t.sharedAncestor}>↔ {t.sharedAncestor}</span>}
    </button>
    <Handle id="child" type="source" position={Position.Bottom} />
  </div>;
}
const nodeTypes = { research: ResearchCard };

function SourceCard({ source }: { source: PrivateResearch["sources"][number] }) {
  return <article className={styles.sourceRecord}><div className={styles.eyebrow}>{source.kind}</div><h3>{source.title}</h3><p>{source.locator}</p>{source.text && <blockquote>{source.text}</blockquote>}{source.url && <a href={source.url} target="_blank" rel="noopener noreferrer">{t.openSource} ↗</a>}</article>;
}

function PersonPlaces({ person, openSource }: { person: ResearchPerson; openSource: (id: string) => void }) {
  const facts = person.placeFacts ?? [];
  const birthFacts = facts.filter(fact => fact.kind === "birth");
  const lifeFacts = facts.filter(fact => fact.kind !== "birth");
  return <section className={styles.places} aria-label={t.places}>
    <h3>{t.places}</h3>
    {birthFacts.length ? birthFacts.map((fact, index) => <div className={styles.placeFact} key={`birth-${index}`}><strong>{t.birth}</strong><span>{fact.dateText || person.birthDate || t.dateUnknown} · {fact.place}</span><small>{fact.status}</small><div>{fact.sourceIds.map(id => <button key={id} onClick={() => openSource(id)}>{t.placeSource} ↗</button>)}</div></div>) : <div className={styles.placeFact}><strong>{t.birth}</strong><span>{person.birthDate || t.dateUnknown} · {person.birthPlace || t.placeUnknown}</span></div>}
    {lifeFacts.map((fact, index) => <div className={styles.placeFact} key={`${fact.kind}-${index}`}><strong>{t[fact.kind]}</strong><span>{fact.dateText || t.dateUnknown} · {fact.place}</span><small>{fact.status}</small><div>{fact.sourceIds.map(id => <button key={id} onClick={() => openSource(id)}>{t.placeSource} ↗</button>)}</div></div>)}
    {!facts.some(fact => fact.kind === "residence") && <div className={styles.placeFact}><strong>{t.residence}</strong><span>{person.residencePlaces?.length ? person.residencePlaces.join(" · ") : t.placeUnknown}</span></div>}
    {!facts.some(fact => fact.kind === "death") && (person.deathDate || person.deathPlace) && <div className={styles.placeFact}><strong>{t.death}</strong><span>{person.deathDate || t.dateUnknown} · {person.deathPlace || t.placeUnknown}</span></div>}
  </section>;
}

function ResearchSpace({ data }: { data: PrivateResearch }) {
  const layout = useMemo(() => ancestryLayout(data), [data]);
  const [selectedId, setSelectedId] = useState<string | null>(layout.rootPersonId);
  const [occurrenceId, setOccurrenceId] = useState<string | null>(layout.nodes[0]?.id ?? null);
  const [branch, setBranch] = useState<"all" | AncestryBranch>("all");
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"map" | "list">("map");
  const [panel, setPanel] = useState<"person" | "chat">("person");
  const [photo, setPhoto] = useState<ResearchPhoto | null>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [relationId, setRelationId] = useState<string | null>(null);
  const [galleryForPerson, setGalleryForPerson] = useState(false);
  const flow = useRef<ReactFlowInstance<PersonNode> | null>(null);
  useEffect(() => {
    if (!query.trim() && branch === "all") return;
    const frame = requestAnimationFrame(() => { void flow.current?.fitView({ padding: .16, maxZoom: .92, duration: 200 }); });
    return () => cancelAnimationFrame(frame);
  }, [query, branch]);
  const selected = data.people.find(person => person.id === selectedId);
  const selectedOccurrence = layout.nodes.find(node => node.id === occurrenceId && node.personId === selectedId) ?? layout.nodes.find(node => node.personId === selectedId);
  const personPhotos = selected ? data.photos.filter(photo => selected.photoIds.includes(photo.id)) : [];
  const gallery = galleryForPerson ? personPhotos : data.photos;
  const sources = selected ? data.sources.filter(source => selected.sourceIds.includes(source.id)) : [];
  const relationships = selected ? data.relationships.filter(relation => relation.from === selected.id || relation.to === selected.id) : [];
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingPeople = data.people.filter(person => (!normalizedQuery || [person.name, person.dates, person.birthPlace, person.relation, ...(person.residencePlaces ?? []), ...(person.placeFacts?.map(fact => fact.place) ?? [])].filter(Boolean).join(" ").toLocaleLowerCase().includes(normalizedQuery)) && (branch === "all" || layout.nodes.some(node => node.personId === person.id && (node.branch === branch || node.branch === "owner"))));
  const matchingIds = new Set(matchingPeople.map(person => person.id));
  const matches = layout.nodes.filter(node => (branch === "all" || node.branch === branch || node.branch === "owner") && matchingIds.has(node.personId));
  const visibleNodes = normalizedQuery ? layout.nodes.filter(node => matches.some(match => node.id === match.id || !node.path.length || (node.path.length <= match.path.length && node.path.every((step, index) => step.relationshipId === match.path[index]?.relationshipId)))) : layout.nodes.filter(node => branch === "all" || node.branch === branch || node.branch === "owner");
  const visibleNodeIds = new Set(visibleNodes.map(node => node.id));
  const select = (personId: string, instanceId?: string, center = false) => {
    const occurrence = layout.nodes.find(node => node.id === instanceId) ?? layout.nodes.find(node => node.personId === personId);
    setSelectedId(personId); setOccurrenceId(occurrence?.id ?? null); setPanel("person"); setSourceId(null); setRelationId(null);
    if (center && occurrence) {
      setView("map"); setQuery(""); setBranch("all");
      requestAnimationFrame(() => { void flow.current?.setCenter(occurrence.x + ANCESTRY_CARD_WIDTH / 2, occurrence.y + ANCESTRY_CARD_HEIGHT / 2, { zoom: .9, duration: 250 }); });
    }
  };
  const nodes: PersonNode[] = visibleNodes.map(occurrence => {
    const person = data.people.find(person => person.id === occurrence.personId)!;
    const picture = data.photos.find(photo => person.photoIds.includes(photo.id));
    return { id: occurrence.id, type: "research", position: { x: occurrence.x, y: occurrence.y }, width: ANCESTRY_CARD_WIDTH, height: ANCESTRY_CARD_HEIGHT, selected: occurrence.id === selectedOccurrence?.id, data: { title: person.name, dates: dateLabel(person), place: birthPlace(person), status: person.status, path: pathLabel(occurrence), branch: occurrence.branch, image: picture?.dataUrl, repeated: occurrence.repeated, onActivate: () => select(person.id, occurrence.id) } };
  });
  const edges: Edge[] = layout.edges.filter(edge => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target)).map(edge => {
    const relation = data.relationships.find(relation => relation.id === edge.relationshipId)!;
    const parent = layout.nodes.find(node => node.id === edge.source)!;
    const color = parent.branch === "paternal" ? "#567a8c" : parent.branch === "maternal" ? "#a47771" : "#848377";
    return { id: edge.id, source: edge.source, target: edge.target, sourceHandle: "child", targetHandle: "parents", label: roleLabel(edge.role), type: "smoothstep", style: { stroke: color, strokeWidth: 2, strokeDasharray: "6 4" }, markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 }, labelStyle: { fill: color, fontSize: 12, fontWeight: 600 }, labelBgStyle: { fill: "#fafbf6", fillOpacity: 1 }, labelBgPadding: [7, 4], ariaLabel: `${roleLabel(edge.role)}: ${relation.status}`, data: { relationshipId: relation.id } };
  });
  const initialFocusIds = layout.nodes.filter(node => node.depth <= 1).map(node => ({ id: node.id }));
  const focusOwner = () => {
    if (!layout.rootPersonId) return;
    select(layout.rootPersonId); setView("map"); setQuery(""); setBranch("all");
    requestAnimationFrame(() => { void flow.current?.fitView({ nodes: initialFocusIds, padding: .14, maxZoom: .92, duration: 250 }); });
  };
  const currentSource = data.sources.find(source => source.id === sourceId);
  const currentRelation = data.relationships.find(relation => relation.id === relationId);
  const photoSource = photo && data.sources.find(source => source.id === photo.sourceId);
  const personName = (id: string) => data.people.find(person => person.id === id)?.name ?? "";
  const openSource = (id: string) => { setPhoto(null); setRelationId(null); setSourceId(id); };

  return <div className={styles.root} data-testid="private-explore">
    <header className={styles.header}>
      <a href="/case" className={styles.brand}>{t.brand}</a>
      <div className={styles.project}><h1>{data.title}</h1><span>{data.owner.name}</span></div>
      <nav><a href="/case/members">{t.memberCabinet}</a><a href="/case">{t.back}</a><a href="/api/private/report" target="_blank" rel="noopener noreferrer">{t.report} ↗</a></nav>
    </header>
    <details className={styles.about}><summary>{t.projectAbout}<span>{t.people}: {data.people.length} · {t.photos}: {data.photos.length}</span></summary><p>{data.summary}</p></details>
    <div className={styles.workspace}>
      <aside className={styles.gallery} aria-label={t.gallery}>
        <div className={styles.sectionHead}><h2>{t.gallery}</h2><span>{gallery.length}</span></div>
        <div className={styles.toggle}><button className={!galleryForPerson ? styles.active : ""} onClick={() => setGalleryForPerson(false)}>{t.allPhotos}</button><button className={galleryForPerson ? styles.active : ""} onClick={() => setGalleryForPerson(true)} disabled={!selected}>{t.personPhotos}</button></div>
        <p className={styles.muted}>{t.galleryHint}</p>
        <div className={styles.galleryGrid}>{gallery.map(photo => <button key={photo.id} aria-label={photo.title} className={styles.galleryPhoto} onClick={() => setPhoto(photo)}><img src={photo.dataUrl} alt="" loading="lazy" /><span>{photo.title}</span></button>)}</div>
        {!gallery.length && <p className={styles.muted}>{t.noPhoto}</p>}
        <div className={styles.questions}><h2>{t.questions}</h2>{data.questions.slice(0, 4).map((question, index) => <details key={`${index}-${question.title}`}><summary>{question.title}</summary><p>{question.why}</p><strong>{t.next}</strong><p>{question.nextStep}</p></details>)}</div>
      </aside>
      <main className={styles.center}>
        <div className={styles.toolbar}>
          <div className={styles.viewTabs}><button className={view === "map" ? styles.active : ""} onClick={() => setView("map")}>{t.map}</button><button className={view === "list" ? styles.active : ""} onClick={() => setView("list")}>{t.list}</button></div>
          <input aria-label={t.search} placeholder={t.search} value={query} onChange={event => setQuery(event.target.value)} />
          <select aria-label={t.branch} value={branch} onChange={event => setBranch(event.target.value as typeof branch)}><option value="all">{t.all}</option><option value="paternal">{t.paternal}</option><option value="maternal">{t.maternal}</option><option value="unspecified">{t.unspecified}</option></select>
        </div>
        <div className={styles.mapActions}><div className={styles.branchLegend}><span className={styles.paternal}>{t.paternal}</span><span className={styles.maternal}>{t.maternal}</span></div><button onClick={focusOwner} disabled={!layout.rootPersonId}>{t.ownerFocus}</button><button onClick={() => { void flow.current?.fitView({ padding: .1, maxZoom: .92, duration: 250 }); }} disabled={view !== "map" || !nodes.length}>{t.allGenerations}</button></div>
        {view === "map" ? <div className={styles.canvas} data-testid="research-map">
          {!visibleNodes.length ? <div className={styles.mapEmpty}><h2>{!layout.rootPersonId ? t.missingRoot : t.noMapMatches}</h2><p>{!layout.rootPersonId ? t.missingRootHint : t.unlinkedHint}</p><button onClick={() => setView("list")}>{t.showList}</button></div> : <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} nodesDraggable={false} nodesConnectable={false} nodesFocusable={false} onInit={instance => { flow.current = instance; }} onEdgeClick={(_event, edge) => setRelationId(edge.data?.relationshipId as string)} fitView fitViewOptions={{ nodes: initialFocusIds, padding: .14, maxZoom: .92 }} minZoom={.05} maxZoom={1.8} ariaLabelConfig={canvasAriaLabels}><Background color="#dce3d7" gap={24} /><Controls showInteractive={false} showFitView={false} /></ReactFlow>}
        </div> : <div className={styles.peopleList}>{matchingPeople.map(person => {
          const occurrence = layout.nodes.find(node => node.personId === person.id);
          return <button key={person.id} className={person.id === selectedId ? styles.selectedList : ""} onClick={() => select(person.id)}><strong>{person.name}</strong><span>{dateLabel(person)}</span><small>{occurrence ? pathLabel(occurrence) : t.notConnected} · {birthPlace(person)}</small><small>{person.status}</small></button>;
        })}{!matchingPeople.length && <p>{t.noResults}</p>}</div>}
        <div className={styles.legend}>{t.connectionHint}</div>
        {layout.unplacedPersonIds.length > 0 && <button className={styles.unlinkedNotice} onClick={() => { setView("list"); setBranch("all"); setQuery(""); }}>{t.unlinkedCount}: {layout.unplacedPersonIds.length} →</button>}
        {layout.omittedCycleIds.length > 0 && <p role="status" className={styles.warning}>{t.cycleWarning}</p>}{layout.truncated && <p role="status" className={styles.warning}>{t.limitWarning}</p>}
      </main>
      <aside className={styles.inspector} aria-label={t.biography} data-testid="research-inspector">
        <div className={styles.panelTabs}><button className={panel === "person" ? styles.active : ""} onClick={() => setPanel("person")}>{t.personTab}</button><button className={panel === "chat" ? styles.active : ""} onClick={() => setPanel("chat")}>{t.chatTab}</button></div>
        <div className={styles.personPanel} hidden={panel !== "person"}>
          {selected ? <>
            <div className={styles.eyebrow}>{selectedOccurrence ? branchLabel(selectedOccurrence.branch) : t.unlinked}</div>
            <h2>{selected.name}</h2><p className={styles.dates}>{dateLabel(selected)}</p>
            {selectedOccurrence ? <div className={styles.path}><span>{t.routeFrom} {data.owner.name}</span><strong>{t.owner}{selectedOccurrence.path.length ? ` → ${pathLabel(selectedOccurrence)}` : ""}</strong><button onClick={() => select(selected.id, selectedOccurrence.id, true)}>{t.showOnMap}</button></div> : <p className={styles.muted}>{t.unlinkedHint}</p>}
            <div className={styles.badge}>{selected.status}</div>
            {personPhotos.length > 0 && <button className={styles.heroPhoto} onClick={() => setPhoto(personPhotos[0])} aria-label={`${t.openPhoto}: ${personPhotos[0].title}`}><img src={personPhotos[0].dataUrl} alt="" /><span>{personPhotos[0].title} ↗</span></button>}
            <PersonPlaces person={selected} openSource={openSource} />
            <h3>{t.biography}</h3><p className={styles.biography}>{selected.biography}</p>
            {personPhotos.length > 1 && <div className={styles.personPhotos}>{personPhotos.slice(1).map(photo => <button key={photo.id} onClick={() => setPhoto(photo)} aria-label={`${t.openPhoto}: ${photo.title}`}><img src={photo.dataUrl} alt="" loading="lazy" /></button>)}</div>}
            <MemberNotes key={selected.id} personId={selected.id} />
            <h3>{t.relationships}</h3>{relationships.length ? relationships.map(relation => <button key={relation.id} className={styles.relation} onClick={() => setRelationId(relation.id)}><strong>{relation.kind === "parent_child" ? `${roleLabel(relation.parentRole ?? "parent")}: ${personName(relation.from)}` : relation.label}</strong><span>{relation.kind === "parent_child" ? `${t.toChild}: ${personName(relation.to)}` : personName(relation.from === selected.id ? relation.to : relation.from)}</span><small>{relation.status}</small></button>) : <p className={styles.muted}>{t.relationsEmpty}</p>}
            <h3>{t.sources} <small>{sources.length}</small></h3>{sources.length ? sources.map(source => <button className={styles.sourceButton} key={source.id} onClick={() => openSource(source.id)}><span>▤</span><div><strong>{source.title}</strong><small>{source.kind}</small></div><span>↗</span></button>) : <p className={styles.muted}>{t.noSources}</p>}
          </> : <><h2>{t.select}</h2><p>{t.selectHint}</p></>}
        </div>
        <div className={styles.chatPanel} hidden={panel !== "chat"}><FamilyChat mode="private" onOpenSource={openSource} /></div>
      </aside>
    </div>
    {photo && <Modal title={photo.title} onClose={() => setPhoto(null)}><div className={styles.dialogHeader}><h2>{photo.title}</h2><button onClick={() => setPhoto(null)} aria-label={t.close}>×</button></div><div className={styles.photoDialog}><img src={photo.dataUrl} alt={photo.title} /><p>{photo.caption}</p><p className={styles.muted}>{t.photoHint}</p>{photoSource && <><div className={styles.eyebrow}>{t.photoSource}</div><SourceCard source={photoSource} /></>}<div className={styles.photoPeople}>{photo.personIds.map(id => <button key={id} onClick={() => { select(id, undefined, true); setPhoto(null); }}>{personName(id)} →</button>)}</div></div></Modal>}
    {currentSource && <Modal title={currentSource.title} onClose={() => setSourceId(null)}><div className={styles.dialogHeader}><h2>{t.origin}</h2><button onClick={() => setSourceId(null)} aria-label={t.close}>×</button></div><SourceCard source={currentSource} />{data.photos.filter(photo => photo.sourceId === currentSource.id).map(photo => <button key={photo.id} className={styles.heroPhoto} onClick={() => { setSourceId(null); setPhoto(photo); }} aria-label={`${t.openPhoto}: ${photo.title}`}><img src={photo.dataUrl} alt="" /></button>)}</Modal>}
    {currentRelation && <Modal title={t.relationships} onClose={() => setRelationId(null)}><div className={styles.dialogHeader}><h2>{currentRelation.kind === "parent_child" ? t.parentOf : currentRelation.label}</h2><button onClick={() => setRelationId(null)} aria-label={t.close}>×</button></div>{currentRelation.kind === "parent_child" ? <><p><strong>{roleLabel(currentRelation.parentRole ?? "parent")}:</strong> {personName(currentRelation.from)}</p><p><strong>{t.toChild}:</strong> {personName(currentRelation.to)}</p><p className={styles.muted}>{currentRelation.label}</p></> : <p>{personName(currentRelation.from)} → {personName(currentRelation.to)}</p>}<div className={styles.badge}>{currentRelation.status}</div><p className={styles.muted}>{t.statusNote}</p>{data.sources.filter(source => currentRelation.sourceIds.includes(source.id)).map(source => <SourceCard key={source.id} source={source} />)}{!currentRelation.sourceIds.length && <p>{t.noSources}</p>}</Modal>}
  </div>;
}

export default function PrivateExplore() {
  const [data, setData] = useState<PrivateResearch | null>(null);
  const [error, setError] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); let mounted = true;
    const timeout = setTimeout(() => controller.abort(), 20000);
    fetch("/api/private/research", { credentials: "same-origin", cache: "no-store", signal: controller.signal }).then(async response => { if (!response.ok) { if (mounted) setError(response.status); return; } const next = await response.json() as PrivateResearch; if (mounted) { setData(next); setError(null); } }).catch(() => { if (mounted) setError(0); }).finally(() => clearTimeout(timeout));
    return () => { mounted = false; clearTimeout(timeout); controller.abort(); };
  }, [attempt]);
  if (data) return <ResearchSpace data={data} />;
  return <div className={styles.loading}><div className={styles.eyebrow}>{t.brand}</div><h1>{error === null ? t.loading : error === 401 || error === 403 ? t.locked : error === 404 ? t.missing : t.failed}</h1>{error !== null && <><p>{error === 401 || error === 403 ? t.lockedHint : error === 404 ? t.missingHint : t.failedHint}</p><div><a href="/case">{t.back}</a><button onClick={() => { setError(null); setAttempt(value => value + 1); }}>{t.retry}</button></div></>}</div>;
}
