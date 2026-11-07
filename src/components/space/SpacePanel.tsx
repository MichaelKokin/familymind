"use client";

import { useEffect, useState } from "react";
import type { PrivateResearch, ResearchPerson, ResearchPhoto } from "@/private-case/research-model";
import type { AncestryBranch, AncestryNode, ParentRole } from "@/private-case/ancestry-layout";
import type { ComposedPerson, ComposedRelationship, SpaceComposition, SpaceLayout, SpaceNode } from "@/private-case/space-layout";
import type { SpaceAction } from "@/private-case/space-logic";
import type { PrivateSpace, SpaceFind, SpaceLead, SpaceMaterial } from "@/private-case/space-model";
import MemberNotes from "../MemberNotes";
import { exploreText as t } from "@/i18n/explore";
import { spaceText as s } from "@/i18n/space";
import styles from "@/app/case/explore/space.module.css";
import { materialSymbol } from "./SpaceCards";
import { formatBytes, formatWhen, mediaUrl, type SpaceDialog } from "./space-client";

export const roleLabel = (role: ParentRole) => (role === "father" ? t.father : role === "mother" ? t.mother : t.parent);
export const branchLabel = (branch: AncestryBranch | "beyond") => (branch === "paternal" ? t.paternal : branch === "maternal" ? t.maternal : branch === "owner" ? t.owner : branch === "beyond" ? t.notConnected : t.unspecified);
export const pathLabel = (node: AncestryNode) => (node.path.length ? node.path.map((step) => roleLabel(step.role)).join(" → ") : t.owner);
export const birthPlace = (person: ResearchPerson | null) => (person ? [...new Set(person.placeFacts?.filter((fact) => fact.kind === "birth").map((fact) => fact.place) ?? [])].join(" / ") || person.birthPlace || t.placeUnknown : t.placeUnknown);
export const dateLabel = (person: ComposedPerson) => person.dateText || t.dateUnknown;
export const statusLabel = (person: ComposedPerson) => (person.origin === "snapshot" ? person.status : `${s.spaceRecord} · ${s.living[person.livingStatus ?? "unknown"]}`);
export const relationStatus = (relation: Pick<ComposedRelationship, "origin" | "status">) => (relation.origin === "space" ? (s.evidence[relation.status as keyof typeof s.evidence] ?? relation.status) : relation.status);

export type PanelContext = {
  composition: SpaceComposition;
  snapshot: PrivateResearch | null;
  space: PrivateSpace;
  layout: SpaceLayout;
  busy: boolean;
  ownerName: string;
  personName: (id: string) => string;
  relationCaption: (person: ComposedPerson, node: SpaceNode) => string;
  selectPerson: (id: string, nodeId?: string | null, center?: boolean) => void;
  selectMaterial: (id: string, center?: boolean) => void;
  selectFind: (id: string, center?: boolean) => void;
  selectLead: (id: string) => void;
  openDialog: (dialog: SpaceDialog) => void;
  mutate: (action: SpaceAction) => Promise<unknown>;
  openSource: (id: string) => void;
  openPhoto: (photo: ResearchPhoto) => void;
  openRelation: (id: string) => void;
};

export function SourceCard({ source }: { source: PrivateResearch["sources"][number] }) {
  return <article className={styles.sourceRecord}><div className={styles.eyebrow}>{source.kind}</div><h3>{source.title}</h3><p>{source.locator}</p>{source.text && <blockquote>{source.text}</blockquote>}{source.url && <a href={source.url} target="_blank" rel="noopener noreferrer">{t.openSource} ↗</a>}</article>;
}

function PersonPlaces({ person, openSource }: { person: ResearchPerson; openSource: (id: string) => void }) {
  const facts = person.placeFacts ?? [];
  const birthFacts = facts.filter((fact) => fact.kind === "birth");
  const lifeFacts = facts.filter((fact) => fact.kind !== "birth");
  return (
    <section className={styles.places} aria-label={t.places}>
      <h3 className={styles.sectionTitle}>{t.places}</h3>
      {birthFacts.length ? birthFacts.map((fact, index) => <div className={styles.placeFact} key={`birth-${index}`}><strong>{t.birth}</strong><span>{fact.dateText || person.birthDate || t.dateUnknown} · {fact.place}</span><small>{fact.status}</small><div>{fact.sourceIds.map((id) => <button key={id} onClick={() => openSource(id)}>{t.placeSource} ↗</button>)}</div></div>) : <div className={styles.placeFact}><strong>{t.birth}</strong><span>{person.birthDate || t.dateUnknown} · {person.birthPlace || t.placeUnknown}</span></div>}
      {lifeFacts.map((fact, index) => <div className={styles.placeFact} key={`${fact.kind}-${index}`}><strong>{t[fact.kind]}</strong><span>{fact.dateText || t.dateUnknown} · {fact.place}</span><small>{fact.status}</small><div>{fact.sourceIds.map((id) => <button key={id} onClick={() => openSource(id)}>{t.placeSource} ↗</button>)}</div></div>)}
      {!facts.some((fact) => fact.kind === "residence") && <div className={styles.placeFact}><strong>{t.residence}</strong><span>{person.residencePlaces?.length ? person.residencePlaces.join(" · ") : t.placeUnknown}</span></div>}
      {!facts.some((fact) => fact.kind === "death") && (person.deathDate || person.deathPlace) && <div className={styles.placeFact}><strong>{t.death}</strong><span>{person.deathDate || t.dateUnknown} · {person.deathPlace || t.placeUnknown}</span></div>}
    </section>
  );
}

function MaterialRow({ material, ctx, selected }: { material: SpaceMaterial; ctx: PanelContext; selected?: boolean }) {
  return (
    <button type="button" className={`${styles.recordRow} ${selected ? styles.selected : ""}`} onClick={() => ctx.selectMaterial(material.id)}>
      {material.original?.mime.startsWith("image/") ? <img src={mediaUrl(material.id)} alt="" loading="lazy" /> : <span className={styles.recordIcon} aria-hidden="true">{materialSymbol[material.kind]}</span>}
      <span><strong>{material.title}</strong><small>{s.materialKinds[material.kind]}{material.origin === "external_find" ? ` · ${s.findManual}` : ""}{material.dateText ? ` · ${material.dateText}` : ""}</small></span>
    </button>
  );
}

function FindRow({ find, ctx }: { find: SpaceFind; ctx: PanelContext }) {
  return (
    <button type="button" className={styles.recordRow} onClick={() => ctx.selectFind(find.id)}>
      <span className={`${styles.recordIcon} ${styles.recordIconFind}`} aria-hidden="true">✦</span>
      <span><strong>{find.title}</strong><small>{s.findKind} · {s.findStatus[find.status]}</small></span>
    </button>
  );
}

function LeadRow({ lead, ctx }: { lead: SpaceLead; ctx: PanelContext }) {
  return (
    <button type="button" className={styles.recordRow} onClick={() => ctx.selectLead(lead.id)}>
      <span className={styles.recordIcon} aria-hidden="true">?</span>
      <span><strong>{lead.question}</strong><small>{s.leadStatus[lead.status]}{lead.personId ? ` · ${ctx.personName(lead.personId)}` : ""}</small></span>
    </button>
  );
}

function MaterialPreview({ material }: { material: SpaceMaterial }) {
  const [text, setText] = useState<string | null>(null);
  const original = material.original;
  useEffect(() => {
    if (original?.mime !== "text/plain") return;
    let mounted = true;
    fetch(mediaUrl(material.id), { credentials: "same-origin", cache: "no-store" }).then(async (response) => (response.ok ? response.text() : "")).then((value) => { if (mounted) setText(value); }).catch(() => { if (mounted) setText(""); });
    return () => { mounted = false; };
  }, [material.id, original?.mime]);
  if (!original) return null;
  if (original.mime.startsWith("image/")) return <div className={styles.preview}><img src={mediaUrl(material.id)} alt={material.title} /></div>;
  if (original.mime === "text/plain") return <div className={styles.preview}><pre>{text ?? "…"}</pre></div>;
  return null;
}

export function OverviewPanel({ ctx }: { ctx: PanelContext }) {
  const { composition, snapshot } = ctx;
  const pending = composition.finds.filter((find) => find.status === "candidate");
  const openLeads = composition.leads.filter((lead) => !["done", "cancelled"].includes(lead.status));
  return (
    <>
      <div className={styles.eyebrow}>{s.brandSubtitle}</div>
      <h2 className={styles.panelTitle}>{s.overviewTitle}</h2>
      <p className={styles.hint}>{s.overviewHint}</p>
      <div className={styles.stats}>
        <div><strong>{composition.people.length}</strong><small>{s.statPeople}</small></div>
        <div><strong>{composition.materials.length}</strong><small>{s.statMaterials}</small></div>
        <div><strong>{openLeads.length}</strong><small>{s.statLeads}</small></div>
        <div><strong>{composition.finds.filter((find) => find.status === "accepted").length}</strong><small>{s.statFinds}</small></div>
      </div>
      {pending.length > 0 && <section className={styles.section}><h3 className={styles.sectionTitle}>{s.candidatesHeading} <small>{pending.length}</small></h3><div className={styles.recordList}>{pending.map((find) => <FindRow key={find.id} find={find} ctx={ctx} />)}</div></section>}
      {openLeads.length > 0 && <section className={styles.section}><h3 className={styles.sectionTitle}>{s.leadsHeading} <small>{openLeads.length}</small></h3><div className={styles.recordList}>{openLeads.map((lead) => <LeadRow key={lead.id} lead={lead} ctx={ctx} />)}</div></section>}
      {snapshot && snapshot.photos.length > 0 && (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{t.gallery} <small>{snapshot.photos.length}</small></h3>
          <p className={styles.hint}>{t.galleryHint}</p>
          <div className={styles.galleryGrid}>{snapshot.photos.map((photo) => <button key={photo.id} type="button" aria-label={photo.title} className={styles.galleryPhoto} onClick={() => ctx.openPhoto(photo)}><img src={photo.dataUrl} alt="" loading="lazy" /><span>{photo.title}</span></button>)}</div>
        </section>
      )}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{s.materialsHeading} <small>{composition.materials.length}</small></h3>
        {composition.materials.length ? <div className={styles.recordList}>{composition.materials.slice(0, 20).map((material) => <MaterialRow key={material.id} material={material} ctx={ctx} />)}</div> : <p className={styles.muted}>{s.noMaterials}</p>}
      </section>
      {snapshot && snapshot.questions.length > 0 && <section className={styles.section}><h3 className={styles.sectionTitle}>{t.questions}</h3>{snapshot.questions.slice(0, 4).map((question, index) => <details key={`${index}-${question.title}`}><summary>{question.title}</summary><p className={styles.muted}>{question.why}</p><strong>{t.next}</strong><p className={styles.muted}>{question.nextStep}</p></details>)}</section>}
      {snapshot?.summary && <section className={styles.section}><h3 className={styles.sectionTitle}>{t.projectAbout}</h3><p className={styles.biography}>{snapshot.summary}</p></section>}
    </>
  );
}

export function PersonPanel({ ctx, person, node }: { ctx: PanelContext; person: ComposedPerson; node: SpaceNode | null }) {
  const { composition, snapshot } = ctx;
  const photos = person.snapshot ? (snapshot?.photos ?? []).filter((photo) => person.snapshot!.photoIds.includes(photo.id)) : [];
  const sources = person.snapshot ? (snapshot?.sources ?? []).filter((source) => person.snapshot!.sourceIds.includes(source.id)) : [];
  const relationships = composition.relationships.filter((relation) => relation.from === person.id || relation.to === person.id);
  const materials = composition.materials.filter((material) => material.personIds.includes(person.id));
  const finds = composition.finds.filter((find) => find.personIds.includes(person.id));
  const leads = composition.leads.filter((lead) => lead.personId === person.id);
  const isRoot = person.id === composition.rootPersonId;
  return (
    <>
      <div className={styles.eyebrow}>{node ? branchLabel(node.branch) : t.unlinked}{person.origin === "space" ? ` · ${s.spaceRecord}` : ` · ${s.snapshotRecord}`}</div>
      <h2 className={styles.panelTitle}>{person.name}</h2>
      <p className={styles.dates}>{dateLabel(person)}</p>
      {node?.occurrence ? <div className={styles.path}><span>{t.routeFrom} {ctx.ownerName}</span><strong>{t.owner}{node.occurrence.path.length ? ` → ${pathLabel(node.occurrence)}` : ""}</strong><button type="button" onClick={() => ctx.selectPerson(person.id, node.id, true)}>{t.showOnMap}</button></div> : node ? <div className={styles.path}><span>{ctx.relationCaption(person, node)}</span><button type="button" onClick={() => ctx.selectPerson(person.id, node.id, true)}>{t.showOnMap}</button></div> : <p className={styles.muted}>{t.unlinkedHint}</p>}
      <div className={styles.badge}>{statusLabel(person)}</div>
      <div className={styles.quickActions}>
        <button type="button" disabled={ctx.busy} onClick={() => ctx.openDialog({ kind: "person", anchorId: person.id, newPersonIs: "parent", editId: null })}>＋ {s.add.parent}</button>
        <button type="button" disabled={ctx.busy} onClick={() => ctx.openDialog({ kind: "person", anchorId: person.id, newPersonIs: "partner", editId: null })}>＋ {s.add.partner}</button>
        <button type="button" disabled={ctx.busy} onClick={() => ctx.openDialog({ kind: "person", anchorId: person.id, newPersonIs: "child", editId: null })}>＋ {s.add.child}</button>
        <button type="button" disabled={ctx.busy} onClick={() => ctx.openDialog({ kind: "material", personIds: [person.id], editId: null, preset: "photo" })}>＋ {s.add.photo}</button>
        <button type="button" disabled={ctx.busy} onClick={() => ctx.openDialog({ kind: "lead", personId: person.id, editId: null, question: "" })}>＋ {s.add.lead}</button>
        {person.record && <button type="button" disabled={ctx.busy} onClick={() => ctx.openDialog({ kind: "person", anchorId: null, newPersonIs: null, editId: person.id })}>{s.edit}</button>}
        {node?.manual && <button type="button" disabled={ctx.busy} onClick={() => { void ctx.mutate({ action: "reset_layout", nodeIds: [node.id] }); }}>{s.resetPosition}</button>}
        {person.record && !isRoot && <button type="button" className={styles.danger} disabled={ctx.busy} onClick={() => { void ctx.mutate({ action: "remove_person", id: person.id }); }}>{s.remove}</button>}
      </div>
      {photos.length > 0 && <button type="button" className={styles.heroPhoto} onClick={() => ctx.openPhoto(photos[0])} aria-label={photos[0].title}><img src={photos[0].dataUrl} alt="" /><span>{photos[0].title} ↗</span></button>}
      {photos.length > 1 && <div className={styles.personPhotos}>{photos.slice(1).map((photo) => <button key={photo.id} type="button" onClick={() => ctx.openPhoto(photo)} aria-label={photo.title}><img src={photo.dataUrl} alt="" loading="lazy" /></button>)}</div>}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{s.materialsAndFinds} <small>{materials.length + finds.length}</small></h3>
        {materials.length || finds.length ? <div className={styles.recordList} data-testid="person-materials">{finds.filter((find) => find.status === "candidate").map((find) => <FindRow key={find.id} find={find} ctx={ctx} />)}{materials.map((material) => <MaterialRow key={material.id} material={material} ctx={ctx} />)}{finds.filter((find) => find.status !== "candidate").map((find) => <FindRow key={find.id} find={find} ctx={ctx} />)}</div> : <p className={styles.muted}>{s.noMaterials}</p>}
      </section>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{s.leadsHeading} <small>{leads.length}</small></h3>
        {leads.length ? <div className={styles.recordList} data-testid="person-leads">{leads.map((lead) => <LeadRow key={lead.id} lead={lead} ctx={ctx} />)}</div> : <p className={styles.muted}>{s.noLeads}</p>}
      </section>
      {person.snapshot && <PersonPlaces person={person.snapshot} openSource={ctx.openSource} />}
      {person.snapshot ? <section className={styles.section}><h3 className={styles.sectionTitle}>{t.biography}</h3><p className={styles.biography}>{person.snapshot.biography}</p></section> : person.record?.notes ? <section className={styles.section}><h3 className={styles.sectionTitle}>{s.personNotes}</h3><p className={styles.biography}>{person.record.notes}</p></section> : null}
      <section className={styles.section}><MemberNotes key={person.id} personId={person.id} /></section>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{t.relationships}</h3>
        {relationships.length ? relationships.map((relation) => <button key={relation.id} type="button" className={styles.relation} onClick={() => ctx.openRelation(relation.id)}><strong>{relation.kind === "parent_child" ? `${roleLabel(relation.parentRole ?? "parent")}: ${ctx.personName(relation.from)}` : relation.kind === "partner" ? `${s.relationKinds.partner}: ${ctx.personName(relation.from === person.id ? relation.to : relation.from)}` : `${relation.label}: ${ctx.personName(relation.from === person.id ? relation.to : relation.from)}`}</strong>{relation.kind === "parent_child" && <span>{t.toChild}: {ctx.personName(relation.to)}</span>}<small>{relationStatus(relation)}{relation.origin === "space" ? ` · ${s.ownerStatement}` : ""}</small></button>) : <p className={styles.muted}>{t.relationsEmpty}</p>}
      </section>
      {person.snapshot && <section className={styles.section}><h3 className={styles.sectionTitle}>{t.sources} <small>{sources.length}</small></h3>{sources.length ? sources.map((source) => <button type="button" className={styles.sourceButton} key={source.id} onClick={() => ctx.openSource(source.id)}><span>▤</span><div><strong>{source.title}</strong><small>{source.kind}</small></div><span>↗</span></button>) : <p className={styles.muted}>{t.noSources}</p>}</section>}
    </>
  );
}

export function MaterialPanel({ ctx, material, node }: { ctx: PanelContext; material: SpaceMaterial; node: SpaceNode | null }) {
  const find = material.findId ? ctx.composition.finds.find((item) => item.id === material.findId) ?? null : null;
  return (
    <>
      <div className={styles.eyebrow}>{s.materialKinds[material.kind]} · {material.origin === "external_find" ? s.originExternal : s.originOwner}</div>
      <h2 className={styles.panelTitle}>{material.title}</h2>
      {material.dateText && <p className={styles.dates}>{material.dateText}</p>}
      <MaterialPreview material={material} />
      {material.text && <p className={styles.biography}>{material.text}</p>}
      {material.url && <p><a href={material.url} target="_blank" rel="noopener noreferrer">{t.openSource} ↗</a></p>}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{s.provenance}</h3>
        <p className={styles.muted}>{material.provenance || s.provenanceUnknown}</p>
        {find && <button type="button" className={styles.secondary} onClick={() => ctx.selectFind(find.id)}>{s.openFind}</button>}
        <p className={styles.muted}>{material.original ? <>{s.originalInfo}: {material.original.name} · {formatBytes(material.original.size)} · <a href={mediaUrl(material.id)} target="_blank" rel="noopener noreferrer" {...(material.original.mime.startsWith("image/") ? {} : { download: material.original.name })}>{material.original.mime.startsWith("image/") ? s.openOriginal : s.downloadOriginal} ↗</a></> : s.noOriginal}</p>
        {!material.original && (material.kind === "photo" || material.kind === "document") && <button type="button" className={styles.secondary} disabled={ctx.busy} onClick={() => ctx.openDialog({ kind: "attach", materialId: material.id })}>{s.attachOriginal}</button>}
      </section>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{s.linkedPeople}</h3>
        {material.personIds.length ? <div className={styles.chips}>{material.personIds.map((id) => <button key={id} type="button" onClick={() => ctx.selectPerson(id, undefined, true)}>{ctx.personName(id)} →</button>)}</div> : <p className={styles.muted}>{s.unlinked}</p>}
      </section>
      <div className={styles.actionsRow}>
        <button type="button" className={styles.secondary} disabled={ctx.busy} onClick={() => ctx.openDialog({ kind: "material", personIds: material.personIds, editId: material.id, preset: null })}>{s.edit}</button>
        <button type="button" className={styles.secondary} onClick={() => ctx.selectMaterial(material.id, true)}>{s.showOnMap}</button>
        {node?.manual && <button type="button" className={styles.secondary} disabled={ctx.busy} onClick={() => { void ctx.mutate({ action: "reset_layout", nodeIds: [node.id] }); }}>{s.resetPosition}</button>}
        <button type="button" className={styles.danger} disabled={ctx.busy} onClick={() => { void ctx.mutate({ action: "remove_material", id: material.id }); }}>{s.remove}</button>
      </div>
    </>
  );
}

export function FindPanel({ ctx, find, node }: { ctx: PanelContext; find: SpaceFind; node: SpaceNode | null }) {
  const lead = find.leadId ? ctx.composition.leads.find((item) => item.id === find.leadId) ?? null : null;
  const material = find.materialId ? ctx.composition.materials.find((item) => item.id === find.materialId) ?? null : null;
  const badge = find.status === "accepted" ? styles.badgeAccent : find.status === "contested" ? styles.badgeContested : find.status === "rejected" ? styles.badgeMuted : styles.badgeFind;
  return (
    <>
      <div className={styles.eyebrow}>{s.findKind} · {s.findManual}</div>
      <h2 className={styles.panelTitle}>{find.title}</h2>
      <div className={`${styles.badge} ${badge}`} data-testid="find-status">{s.findStatus[find.status]}</div>
      <div className={styles.badge}>{s.findNovelty[find.novelty]}</div>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{s.findAbout}</h3>
        {find.personIds.length ? <div className={styles.chips}>{find.personIds.map((id) => <button key={id} type="button" onClick={() => ctx.selectPerson(id, undefined, true)}>{ctx.personName(id)} →</button>)}</div> : <p className={styles.muted}>{s.unlinked}</p>}
      </section>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{s.findSource}</h3>
        <p><strong>{find.source.title}</strong>{find.source.kind ? ` · ${find.source.kind}` : ""}</p>
        {find.source.dateText && <p className={styles.muted}>{s.findDate}: {find.source.dateText}</p>}
        {find.source.locator && <p className={styles.muted}>{s.findLocator}: {find.source.locator}</p>}
        {find.source.excerpt && <blockquote className={styles.quote}>{find.source.excerpt}</blockquote>}
        {find.source.url && <p><a href={find.source.url} target="_blank" rel="noopener noreferrer">{s.findOpenSource} ↗</a></p>}
      </section>
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{s.findWhy}</h3>
        <p className={styles.biography}>{find.why}</p>
      </section>
      {find.status === "candidate" ? (
        <div className={styles.actionsRow}>
          <button type="button" className={styles.primary} disabled={ctx.busy} onClick={() => ctx.openDialog({ kind: "decide", findId: find.id, decision: "accepted" })}>{s.findAccept}</button>
          <button type="button" className={styles.warn} disabled={ctx.busy} onClick={() => ctx.openDialog({ kind: "decide", findId: find.id, decision: "contested" })}>{s.findContest}</button>
          <button type="button" className={styles.danger} disabled={ctx.busy} onClick={() => ctx.openDialog({ kind: "decide", findId: find.id, decision: "rejected" })}>{s.findReject}</button>
        </div>
      ) : (
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{s.findDecidedAt}</h3>
          <p className={styles.biography}>{find.decisionReason}</p>
          {find.decidedAt && <p className={styles.muted}>{formatWhen(find.decidedAt)}</p>}
          {material && <button type="button" className={styles.secondary} onClick={() => ctx.selectMaterial(material.id, true)}>{s.findPlaced} →</button>}
        </section>
      )}
      <p className={styles.hint}>{s.findStatusNote}</p>
      {lead && <section className={styles.section}><h3 className={styles.sectionTitle}>{s.leadQuestion}</h3><div className={styles.recordList}><LeadRow lead={lead} ctx={ctx} /></div></section>}
      {node?.manual && <div className={styles.actionsRow}><button type="button" className={styles.secondary} disabled={ctx.busy} onClick={() => { void ctx.mutate({ action: "reset_layout", nodeIds: [node.id] }); }}>{s.resetPosition}</button></div>}
    </>
  );
}

export function LeadPanel({ ctx, lead }: { ctx: PanelContext; lead: SpaceLead }) {
  const finds = ctx.composition.finds.filter((find) => find.leadId === lead.id);
  const pending = finds.filter((find) => find.status === "candidate");
  const stage = lead.status === "open" ? 1 : lead.status === "needs_detail" || lead.status === "nothing_found" || lead.status === "candidate" ? 2 : 3;
  const timeline = [s.leadTimeline.asked, s.leadTimeline.searching, s.leadTimeline.outcome, s.leadTimeline.decision];
  const outcomeText = lead.status === "candidate" ? `${s.leadStatus.candidate}: ${pending.length}` : lead.status === "nothing_found" ? s.leadStatus.nothing_found : lead.status === "needs_detail" ? `${s.leadStatus.needs_detail}: ${lead.missingDetail}` : lead.status === "done" ? s.leadStatus.done : lead.status === "cancelled" ? s.leadStatus.cancelled : "";
  const active = lead.status !== "done" && lead.status !== "cancelled";
  return (
    <>
      <div className={styles.eyebrow}>{s.leadsHeading} · {s.findManual}</div>
      <h2 className={styles.panelTitle}>{lead.question}</h2>
      {lead.personId && <div className={styles.chips}><button type="button" onClick={() => ctx.selectPerson(lead.personId!, undefined, true)}>{ctx.personName(lead.personId)} →</button></div>}
      {(lead.placeText || lead.periodText) && <p className={styles.dates}>{[lead.placeText, lead.periodText].filter(Boolean).join(" · ")}</p>}
      <div className={styles.timeline} aria-label={s.leadsHeading}>
        {timeline.map((label, index) => <div key={label} className={`${styles.timelineStep} ${index < stage ? styles.done : index === stage ? styles.active : ""}`}>{label}{index === 2 && outcomeText ? <strong>{outcomeText}</strong> : null}</div>)}
      </div>
      <div className={`${styles.badge} ${lead.status === "done" ? styles.badgeAccent : lead.status === "candidate" ? styles.badgeFind : lead.status === "cancelled" ? styles.badgeMuted : ""}`} data-testid="lead-status">{s.leadStatus[lead.status]}</div>
      <p className={styles.notice}>{s.leadManualHint}</p>
      {lead.coverage && <section className={styles.section}><h3 className={styles.sectionTitle}>{s.leadCoverage}</h3><p className={styles.biography}>{lead.coverage}</p></section>}
      {lead.missingDetail && <section className={styles.section}><h3 className={styles.sectionTitle}>{s.leadMissingDetail}</h3><p className={styles.biography}>{lead.missingDetail}</p></section>}
      {lead.nextQuestion && <section className={styles.section}><h3 className={styles.sectionTitle}>{s.leadNextQuestion}</h3><p className={styles.biography}>{lead.nextQuestion}</p><button type="button" className={styles.secondary} disabled={ctx.busy} onClick={() => ctx.openDialog({ kind: "lead", personId: lead.personId, editId: null, question: lead.nextQuestion })}>＋ {s.add.lead}</button></section>}
      <section className={styles.section}>
        <h3 className={styles.sectionTitle}>{s.candidatesHeading} <small>{finds.length}</small></h3>
        {finds.length ? <div className={styles.recordList}>{finds.map((find) => <FindRow key={find.id} find={find} ctx={ctx} />)}</div> : <p className={styles.muted}>{s.noCandidates}</p>}
      </section>
      <div className={styles.actionsRow}>
        {active && <button type="button" className={styles.primary} disabled={ctx.busy} onClick={() => ctx.openDialog({ kind: "find", leadId: lead.id, personIds: lead.personId ? [lead.personId] : [] })}>{s.leadAddFind}</button>}
        {pending[0] && <button type="button" className={styles.warn} onClick={() => ctx.selectFind(pending[0].id, true)}>{s.findCheck}</button>}
        {active && lead.status !== "nothing_found" && <button type="button" className={styles.secondary} disabled={ctx.busy} onClick={() => ctx.openDialog({ kind: "leadOutcome", leadId: lead.id, outcome: "nothing_found" })}>{s.leadNothing}</button>}
        {active && lead.status !== "needs_detail" && <button type="button" className={styles.secondary} disabled={ctx.busy} onClick={() => ctx.openDialog({ kind: "leadOutcome", leadId: lead.id, outcome: "needs_detail" })}>{s.leadNeedsDetail}</button>}
        <button type="button" className={styles.secondary} disabled={ctx.busy} onClick={() => ctx.openDialog({ kind: "lead", personId: lead.personId, editId: lead.id, question: "" })}>{s.edit}</button>
        {active && <button type="button" className={styles.danger} disabled={ctx.busy} onClick={() => { void ctx.mutate({ action: "update_lead", id: lead.id, lead: {}, status: "cancelled" }); }}>{s.leadCancel}</button>}
        {!active && <button type="button" className={styles.secondary} disabled={ctx.busy} onClick={() => { void ctx.mutate({ action: "update_lead", id: lead.id, lead: {}, status: "open" }); }}>{s.leadReopen}</button>}
      </div>
    </>
  );
}
