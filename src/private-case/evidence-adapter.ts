import { parsePrivateCase, type PrivateCase } from "./model";

/** Exact header order from the vendored 1.34.0 templates, pinned in PROVENANCE.json. */
export const EVIDENCE_COLUMNS = {
  "artifact-register.csv": "artifact_id,captured_at,source_title,source_url_or_path,source_type,repository_or_archive,archival_reference,record_date,place_as_written,language_script,person_ids,names_as_written,summary,provenance_level,directness,originality,independence_group,legibility,access_notes,sha256,related_claim_ids,reliability_notes,status",
  "claims-register.csv": "claim_id,claim_text,subject_person_ids,claim_type,artifact_ids,supporting_independence_groups,contradicting_artifact_ids,status,confidence,rationale,next_action",
  "person-register.csv": "person_id,preferred_label,living_status,names_as_written,normalized_name_variants,birth_estimate,death_estimate,places,historical_jurisdictions,relatives_as_reported,occupation_or_status,confession_or_community_as_recorded,source_artifact_ids,candidate_status,merge_or_split_rationale,notes",
  "relationship-register.csv": "relationship_id,person_a_id,relationship_type,person_b_id,biological_legal_household,claim_ids,supporting_artifact_ids,contradicting_artifact_ids,independence_groups,status,confidence,rationale",
} as const;

export type EvidenceRegisterName = keyof typeof EVIDENCE_COLUMNS;
export interface EvidenceRegisters {
  files: Record<EvidenceRegisterName, string>;
  counts: { persons: number; artifacts: number; claims: number; relationships: number };
  limitations: string[];
}

const messages = {
  structuralOnly: "Аудит проверяет ссылки и минимальные условия, а не историческую истинность.",
  noRelationships: "Связи не экспортируются: текущая карточка не содержит явных рёбер между person_id; текст предложений AI не превращается в родство.",
  conservativeClaims: "Утверждения дерева экспортированы как hypothesis, остальные как unresolved: данных для оценки прямоты, противоречий и независимости каждого утверждения недостаточно.",
  missingGroups: "Для части источников независимость не установлена; пустые группы оставлены для ручной проверки и предупреждения аудитора.",
  csvEscaped: "CSV предназначены для аудита. Ячейки с префиксом формулы защищены апострофом; точный оригинальный текст остаётся в JSON дела.",
  sourceLead: "Доступный фрагмент источника, не проверенный образ оригинала. Источник сохранён как наводка.",
  treeAssertion: "Утверждение пользовательского дерева; первоисточник и независимое подтверждение не установлены.",
  unresolvedAssertion: "Исходная карточка не хранит достаточную оценку доказательств по конкретному утверждению; статус не повышен автоматически.",
  subjectScope: "Лицо исследования; принадлежность отдельных записей этому человеку требует проверки.",
  datePrefix: "Исходная датировка без определения типа события: ",
  locatorPrefix: "Локатор в источнике (не архивный шифр): ",
};

function csvCell(value: string): string {
  // Quoting alone does not prevent a spreadsheet from interpreting formulas.
  const safe = /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

function register(name: EvidenceRegisterName, rows: Record<string, string>[]): string {
  const header = EVIDENCE_COLUMNS[name];
  const columns = header.split(",");
  return header + "\r\n" + rows.map((row) => columns.map((key) => csvCell(row[key] || "")).join(",") + "\r\n").join("");
}

/** No inference, I/O or model call: conservatively project one authorized case. */
export function buildEvidenceRegisters(input: PrivateCase): EvidenceRegisters {
  const value = parsePrivateCase(input);
  const artifacts = value.sources.map((source) => ({
    artifact_id: source.id,
    captured_at: source.observedAt,
    source_title: source.title,
    source_url_or_path: source.url,
    source_type: source.kind === "user_tree" ? "user-tree" : source.kind,
    access_notes: source.locator ? messages.locatorPrefix + source.locator : "",
    person_ids: value.subject.personId,
    summary: source.excerpt,
    provenance_level: "unknown",
    directness: "lead-only",
    originality: source.kind === "user_tree" ? "derivative" : "unknown",
    independence_group: source.independenceGroup || "",
    related_claim_ids: value.known.filter((known) => known.sourceIds.includes(source.id)).map((known) => known.id).join(";"),
    reliability_notes: messages.sourceLead,
    status: "lead-only",
  }));
  const claims = value.known.map((known) => ({
    claim_id: known.id,
    claim_text: known.text,
    subject_person_ids: value.subject.personId,
    claim_type: "research-assertion",
    artifact_ids: known.sourceIds.join(";"),
    supporting_independence_groups: [...new Set(known.sourceIds.map((id) => value.sources.find((source) => source.id === id)?.independenceGroup).filter((id): id is string => Boolean(id)))].join(";"),
    status: known.status === "tree_assertion" ? "hypothesis" : "unresolved",
    rationale: known.status === "tree_assertion" ? messages.treeAssertion : messages.unresolvedAssertion,
    next_action: value.question,
  }));
  const persons = [{
    person_id: value.subject.personId,
    preferred_label: value.subject.name,
    living_status: value.subject.livingStatus,
    names_as_written: value.subject.name,
    source_artifact_ids: value.sources.map((source) => source.id).join(";"),
    candidate_status: "unresolved",
    merge_or_split_rationale: messages.subjectScope,
    notes: [value.subject.dateText ? messages.datePrefix + value.subject.dateText : "", value.notes].filter(Boolean).join("\n"),
  }];
  return {
    files: {
      "artifact-register.csv": register("artifact-register.csv", artifacts),
      "claims-register.csv": register("claims-register.csv", claims),
      "person-register.csv": register("person-register.csv", persons),
      "relationship-register.csv": register("relationship-register.csv", []),
    },
    counts: { persons: persons.length, artifacts: artifacts.length, claims: claims.length, relationships: 0 },
    limitations: [messages.structuralOnly, messages.noRelationships, messages.conservativeClaims, messages.csvEscaped, ...(value.sources.some((source) => !source.independenceGroup) ? [messages.missingGroups] : [])],
  };
}
