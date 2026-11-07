"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { AncestryBranch } from "@/private-case/ancestry-layout";
import type { MaterialKind } from "@/private-case/space-model";
import { exploreText as t } from "@/i18n/explore";
import { spaceText as s } from "@/i18n/space";
import styles from "@/app/case/explore/space.module.css";

export type PersonCardData = {
  card: "person";
  title: string;
  dates: string;
  place: string;
  status: string;
  path: string;
  branch: AncestryBranch | "beyond";
  image?: string;
  repeated: boolean;
  origin: "snapshot" | "space";
  materialCount: number;
  isNew: boolean;
  onActivate: () => void;
  [key: string]: unknown;
};
export type MaterialCardData = {
  card: "material";
  title: string;
  kind: MaterialKind;
  kindLabel: string;
  image?: string;
  caption: string;
  people: string;
  external: boolean;
  isNew: boolean;
  onActivate: () => void;
  [key: string]: unknown;
};
export type FindCardData = {
  card: "find";
  title: string;
  about: string;
  source: string;
  why: string;
  isNew: boolean;
  onActivate: () => void;
  [key: string]: unknown;
};
export type CardData = PersonCardData | MaterialCardData | FindCardData;
export type SpaceFlowNode = Node<CardData>;

export const materialSymbol: Record<MaterialKind, string> = { photo: "▣", document: "▤", note: "✎", link: "↗" };

function PersonCard({ data, selected }: NodeProps<SpaceFlowNode>) {
  if (data.card !== "person") return null;
  return (
    <div className={`${styles.personCard} ${styles[data.branch]} ${selected ? styles.selectedCard : ""} ${data.isNew ? styles.isNew : ""}`}>
      <Handle id="parents" type="target" position={Position.Top} />
      <Handle id="side-in" type="target" position={Position.Left} />
      <button type="button" className={styles.cardButton} onClick={data.onActivate} aria-label={`${data.title}, ${data.path}, ${data.dates}`}>
        <div className={styles.cardTop}>
          {data.image ? <img className={styles.personPhoto} src={data.image} alt="" /> : <span className={styles.personInitial}>{data.title.slice(0, 1)}</span>}
          <span className={styles.cardPath} title={data.path}>{data.path}</span>
          {data.origin === "space" && <span className={styles.ownerBadge}>{s.spaceRecord}</span>}
        </div>
        <strong className={styles.personName}>{data.title}</strong>
        <span className={styles.cardDates}>{data.dates}</span>
        <span className={styles.cardPlace} title={data.place}>{data.place}</span>
        <span className={styles.cardStatus}>{data.status}{data.materialCount > 0 ? ` · ${s.materialsHeading}: ${data.materialCount}` : ""}</span>
        {data.repeated && <span className={styles.shared} title={t.sharedAncestor}>↔ {t.sharedAncestor}</span>}
      </button>
      <Handle id="child" type="source" position={Position.Bottom} />
      <Handle id="side-out" type="source" position={Position.Right} />
    </div>
  );
}

function MaterialCard({ data, selected }: NodeProps<SpaceFlowNode>) {
  if (data.card !== "material") return null;
  return (
    <div className={`${styles.materialCard} ${selected ? styles.selectedMaterial : ""} ${data.isNew ? styles.isNew : ""}`}>
      <Handle id="out" type="source" position={Position.Left} />
      <button type="button" className={styles.materialButton} onClick={data.onActivate} aria-label={`${data.kindLabel}: ${data.title}`}>
        {data.image && <img className={styles.materialStrip} src={data.image} alt="" loading="lazy" />}
        <div className={styles.materialBody}>
          <div className={styles.materialTop}>
            {!data.image && <span className={styles.materialIcon} aria-hidden="true">{materialSymbol[data.kind]}</span>}
            <span className={styles.materialKind}>{data.kindLabel}{data.external ? ` · ${s.findManual}` : ""}</span>
          </div>
          <strong className={styles.materialTitle}>{data.title}</strong>
          <span className={styles.materialMeta} title={data.caption}>{data.caption}</span>
          <span className={styles.materialMeta}>{data.people || s.unlinked}</span>
        </div>
      </button>
    </div>
  );
}

function FindCard({ data, selected }: NodeProps<SpaceFlowNode>) {
  if (data.card !== "find") return null;
  return (
    <div className={`${styles.findCard} ${selected ? styles.selectedFind : ""} ${data.isNew ? styles.isNew : ""}`}>
      <Handle id="out" type="source" position={Position.Left} />
      <button type="button" className={styles.findButton} onClick={data.onActivate} aria-label={`${s.findKind}: ${data.title}`}>
        <span className={styles.findEyebrow}>{s.findKind} · {s.findManual}</span>
        <strong className={styles.findTitle}>{data.title}</strong>
        <span className={styles.findMeta}>{s.findAbout}: {data.about || "—"}</span>
        <span className={styles.findMeta}>{s.findSource}: {data.source}</span>
        <span className={styles.findWhy}>{data.why}</span>
        <span className={styles.findAction}>{s.findCheck}</span>
      </button>
    </div>
  );
}

export const spaceNodeTypes = { person: PersonCard, material: MaterialCard, find: FindCard };
