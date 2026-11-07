"use client";
import { useMemo, useCallback, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  applyNodeChanges,
  type Node,
  type NodeProps,
  type Edge,
  type OnNodesChange,
} from "@xyflow/react";
import type { Workspace } from "@/domain/model";
import { canvasAriaLabels } from "@/i18n/canvas";
import { ru as t } from "@/i18n/ru";
type CardData = {
  kind: string;
  title: string;
  subtitle: string;
  badge: string;
  selected: boolean;
  [key: string]: unknown;
};
function FamilyCard({ data }: NodeProps<Node<CardData>>) {
  return (
    <div
      className={`canvas-card ${data.kind} ${data.selected ? "is-selected" : ""}`}
    >
      <Handle type="target" position={Position.Left} />
      <div className="card-top">
        <span className="card-symbol">
          {data.kind === "person"
            ? "◉"
            : data.kind === "source"
              ? "▤"
              : data.kind === "question"
                ? "?"
                : "◇"}
        </span>
        <span className="card-kind">
          {data.kind === "person"
            ? t.person
            : data.kind === "source"
              ? t.source
              : data.kind === "question"
                ? t.question
                : t.claim}
        </span>
        <span className="demo-dot" title={t.synthetic} />
      </div>
      <strong>{data.title}</strong>
      <p>{data.subtitle}</p>
      <span className="card-badge">{data.badge}</span>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
const nodeTypes = { family: FamilyCard };
export default function FamilyCanvas({
  workspace,
  selectedId,
  filter,
  onSelect,
  onPositionsChange,
}: {
  workspace: Workspace;
  selectedId: string | null;
  filter: string;
  onSelect: (id: string) => void;
  onPositionsChange: (positions: Workspace["positions"]) => void;
}) {
  const baseNodes = useMemo(() => {
    const cards: Array<{
      id: string;
      kind: string;
      title: string;
      subtitle: string;
      badge: string;
    }> = [];
    workspace.people.forEach((p) =>
      cards.push({
        id: p.id,
        kind: "person",
        title: p.name,
        subtitle: p.dateText || t.calendarNames.unknown,
        badge: p.variants[0] || t.living[p.livingStatus],
      }),
    );
    workspace.sources.forEach((s) =>
      cards.push({
        id: s.id,
        kind: "source",
        title: s.title,
        subtitle: s.citation,
        badge: t.synthetic,
      }),
    );
    workspace.claims.forEach((c) =>
      cards.push({
        id: c.id,
        kind: "claim",
        title: `${c.predicate}: ${c.value}`,
        subtitle: workspace.people.find((p) => p.id === c.personId)?.name || "",
        badge: t.evidenceNames[c.evidenceStatus],
      }),
    );
    workspace.questions.forEach((q) =>
      cards.push({
        id: q.id,
        kind: "question",
        title: q.question,
        subtitle: q.place,
        badge: t.research,
      }),
    );
    return cards.map((c, i) => ({
      id: c.id,
      type: "family",
      selected: c.id === selectedId,
      position: workspace.positions[c.id] || {
        x: (i % 4) * 310,
        y: Math.floor(i / 4) * 240,
      },
      data: { ...c, selected: c.id === selectedId },
      style: {
        opacity:
          filter &&
          !`${c.title} ${c.subtitle}`
            .toLowerCase()
            .includes(filter.toLowerCase())
            ? 0.2
            : 1,
      },
      ariaLabel: `${c.title}, ${c.subtitle}`,
    }));
  }, [workspace, selectedId, filter]);
  const [nodes, setNodes] = useState<Node<CardData>[]>(baseNodes);
  const [previousNodes, setPreviousNodes] = useState(baseNodes);
  if (previousNodes !== baseNodes) {
    setPreviousNodes(baseNodes);
    setNodes(baseNodes);
  }
  const onNodesChange: OnNodesChange<Node<CardData>> = useCallback(
    (changes) => setNodes((ns) => applyNodeChanges(changes, ns)),
    [],
  );
  const edges = useMemo(() => {
    const es: Edge[] = workspace.claims.map((c) => ({
      id: `person-${c.id}`,
      source: c.personId,
      target: c.id,
      label: t.subjectOf,
      style: { stroke: "#a4b3ac" },
    }));
    workspace.evidence.forEach((e) => {
      const rel = workspace.relationships.find((r) => r.id === e.targetId);
      es.push({
        id: e.id,
        source: e.sourceId,
        target: rel ? rel.fromPersonId : e.targetId,
        label: t.polarities[e.polarity],
        style: {
          stroke: e.polarity === "contradicts" ? "#bd7050" : "#a4b3ac",
          strokeDasharray: e.polarity === "lead" ? "4 4" : undefined,
        },
      });
    });
    workspace.relationships.forEach((r) =>
      es.push({
        id: r.id,
        source: r.fromPersonId,
        target: r.toPersonId,
        label: `${t.relationNames[r.kind]} · ${t.evidenceNames[r.evidenceStatus]}`,
        style: {
          stroke: "#b68c48",
          strokeWidth: 2,
          strokeDasharray: "7 5",
          opacity: r.workflowStatus === "rejected" ? 0.4 : 1,
        },
      }),
    );
    return es;
  }, [workspace]);
  return (
    <div
      className="canvas-area"
      data-testid="family-canvas"
      onKeyUp={(event) => {
        if (event.key === "Enter" && event.target instanceof HTMLElement) {
          const node = event.target.closest<HTMLElement>(".react-flow__node");
          if (node?.dataset.id) onSelect(node.dataset.id);
        }
        if (
          ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
            event.key,
          ) &&
          event.target instanceof HTMLElement &&
          event.target.closest(".react-flow__node")
        ) {
          onPositionsChange(
            Object.fromEntries(nodes.map((node) => [node.id, node.position])),
          );
        }
      }}
    >
      <ReactFlow
        ariaLabelConfig={canvasAriaLabels}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onNodeClick={(_, node) => onSelect(node.id)}
        onEdgeClick={(_, edge) => {
          if (workspace.relationships.some((r) => r.id === edge.id))
            onSelect(edge.id);
          else {
            const e = workspace.evidence.find((e) => e.id === edge.id);
            if (e) onSelect(e.targetId);
          }
        }}
        onNodeDragStop={(_, node, moved) =>
          onPositionsChange(
            Object.fromEntries(
              (moved.length ? moved : [node]).map((item) => [
                item.id,
                item.position,
              ]),
            ),
          )
        }
        nodesConnectable={false}
        deleteKeyCode={null}
        fitView
        minZoom={0.2}
        maxZoom={1.6}
        fitViewOptions={{ padding: 0.18 }}
      >
        <Background color="#cbd4cd" gap={24} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          nodeColor={(n) =>
            n.data.kind === "person"
              ? "#417666"
              : n.data.kind === "source"
                ? "#bda882"
                : "#9da8a1"
          }
        />
      </ReactFlow>
      <div className="canvas-caption">
        <span className="legend-line" />
        {t.legend}
      </div>
    </div>
  );
}
