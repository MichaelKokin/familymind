import { encodeBytes } from "../data/files";
import { newId, parseWorkspace, type Artifact, type Workspace } from "./model";

export function createEmptyWorkspace(title = "Новое исследование"): Workspace {
  return {
    schemaVersion: 1,
    id: newId("workspace"),
    title,
    synthetic: true,
    revision: 0,
    updatedAt: new Date().toISOString(),
    people: [],
    sources: [],
    artifacts: [],
    claims: [],
    relationships: [],
    evidence: [],
    reviews: [],
    questions: [],
    runs: [],
    positions: {},
  };
}

function textArtifact(
  id: string,
  sourceId: string,
  name: string,
  text: string,
): Artifact {
  const bytes = new TextEncoder().encode(text);
  return {
    id,
    sourceId,
    name,
    mime: "text/plain",
    size: bytes.length,
    dataUrl: `data:text/plain;base64,${encodeBytes(bytes)}`,
    transcription: text,
    exportAllowed: true,
    synthetic: true,
  };
}

export function createDemoWorkspace(): Workspace {
  const date = new Date().toISOString();
  const originalText =
    "СИНТЕТИЧЕСКИЙ ПРИМЕР. Не архивный документ.\nВымышленная запись о рождении, лист 12.\nАлексей Ветров, рождение: 1898 год. Место: вымышленное село Луговое.\nСведения об отце в этом фрагменте отсутствуют.";
  const censusText =
    "СИНТЕТИЧЕСКИЙ ПРИМЕР. Не архивный документ.\nВымышленная переписная карточка, лист 4.\nАлексей Ветров, год рождения: 1900. Проживает в вымышленном Луговом.\nЛичность и причина расхождения с записью о рождении требуют проверки.";
  const letterText =
    "СИНТЕТИЧЕСКИЙ ПРИМЕР. Не семейное письмо.\nВымышленное воспоминание, страница 1.\nМария упоминает Петра Ветрова как человека, который жил рядом с Алексеем.\nРодство не указано.";
  return parseWorkspace({
    ...createEmptyWorkspace("Семья Ветровых"),
    id: "demo-workspace",
    people: [
      {
        id: "person-alexey",
        name: "Алексей Ветров",
        variants: ["Алексѣй Вѣтровъ"],
        dateText: "1898 или 1900 — спорно",
        calendar: "unknown",
        livingStatus: "deceased",
        notes:
          "Вымышленный участник исследования. Два документа расходятся в годе рождения.",
        synthetic: true,
      },
      {
        id: "person-maria",
        name: "Мария Ветрова",
        variants: ["Мария Соколова"],
        dateText: "около 1902",
        calendar: "unknown",
        livingStatus: "deceased",
        notes:
          "Вымышленная рассказчица. Приблизительная дата не является установленным фактом.",
        synthetic: true,
      },
      {
        id: "person-petr",
        name: "Пётр Ветров",
        variants: ["Петр Ветров"],
        dateText: "около 1870",
        calendar: "unknown",
        livingStatus: "deceased",
        notes: "Совпадение фамилии и соседство не доказывают отцовство.",
        synthetic: true,
      },
      {
        id: "person-namesake",
        name: "Алексей Ветров",
        variants: [],
        dateText: "1911",
        calendar: "gregorian",
        livingStatus: "unknown",
        notes:
          "Отдельный вымышленный однофамилец. Не объединять по совпадению имени.",
        synthetic: true,
      },
    ],
    sources: [
      {
        id: "source-birth",
        title: "Запись о рождении · 1898",
        citation: "Демо-коллекция / вымышленный журнал / лист 12",
        url: "",
        originalId: "original-birth",
        notes: "Синтетический документ, созданный для проверки сценария.",
        synthetic: true,
      },
      {
        id: "source-birth-copy",
        title: "Копия той же записи",
        citation: "Демо-каталог / копия листа 12",
        url: "",
        originalId: "original-birth",
        notes: "Та же исходная запись: не независимое подтверждение.",
        synthetic: true,
      },
      {
        id: "source-census",
        title: "Переписная карточка · 1900",
        citation: "Демо-коллекция / вымышленная карточка / лист 4",
        url: "",
        originalId: "original-census",
        notes: "Содержит конфликтующий год рождения.",
        synthetic: true,
      },
      {
        id: "source-memory",
        title: "Воспоминание Марии",
        citation: "Демо-воспоминание / страница 1",
        url: "",
        originalId: "original-memory",
        notes: "Не устанавливает родство; только направление проверки.",
        synthetic: true,
      },
    ],
    artifacts: [
      textArtifact(
        "artifact-birth",
        "source-birth",
        "demo-birth.txt",
        originalText,
      ),
      textArtifact(
        "artifact-copy",
        "source-birth-copy",
        "demo-birth-copy.txt",
        originalText,
      ),
      textArtifact(
        "artifact-census",
        "source-census",
        "demo-census.txt",
        censusText,
      ),
      textArtifact(
        "artifact-memory",
        "source-memory",
        "demo-memory.txt",
        letterText,
      ),
    ],
    claims: [
      {
        id: "claim-birth-1898",
        personId: "person-alexey",
        predicate: "Год рождения",
        value: "1898",
        evidenceStatus: "contradicted",
        rationale:
          "Переписная карточка указывает 1900. Копия записи не добавляет независимую цепочку.",
        workflowStatus: "needs_review",
        alternativesReviewed: false,
        synthetic: true,
      },
      {
        id: "claim-birth-1900",
        personId: "person-alexey",
        predicate: "Год рождения",
        value: "1900",
        evidenceStatus: "contradicted",
        rationale:
          "Расходится с записью о рождении: 1898. Возможен однофамилец.",
        workflowStatus: "needs_review",
        alternativesReviewed: false,
        synthetic: true,
      },
      {
        id: "claim-place",
        personId: "person-alexey",
        predicate: "Место проживания",
        value: "Луговое (вымышленное село)",
        evidenceStatus: "single-source",
        rationale: "Указано в одной синтетической переписной карточке.",
        workflowStatus: "accepted",
        alternativesReviewed: false,
        synthetic: true,
      },
    ],
    relationships: [
      {
        id: "relationship-parent",
        fromPersonId: "person-petr",
        toPersonId: "person-alexey",
        kind: "parent",
        evidenceStatus: "hypothesis",
        rationale:
          "Демонстрационный пример предложения. Общая фамилия и соседство — повод проверить, а не доказательство отцовства.",
        workflowStatus: "proposed",
        alternativesReviewed: false,
        synthetic: true,
      },
      {
        id: "relationship-spouse",
        fromPersonId: "person-alexey",
        toPersonId: "person-maria",
        kind: "spouse",
        evidenceStatus: "hypothesis",
        rationale:
          "Демонстрационная семейная версия без документального подтверждения.",
        workflowStatus: "proposed",
        alternativesReviewed: false,
        synthetic: true,
      },
    ],
    evidence: [
      {
        id: "evidence-birth",
        targetId: "claim-birth-1898",
        sourceId: "source-birth",
        artifactId: "artifact-birth",
        polarity: "supports",
        locator: "Лист 12",
        excerpt: "Алексей Ветров, рождение: 1898 год.",
        independenceGroup: "birth-chain",
        rationale: "Прямая запись в синтетическом примере.",
        direct: true,
      },
      {
        id: "evidence-birth-copy",
        targetId: "claim-birth-1898",
        sourceId: "source-birth-copy",
        artifactId: "artifact-copy",
        polarity: "supports",
        locator: "Копия листа 12",
        excerpt: "Алексей Ветров, рождение: 1898 год.",
        independenceGroup: "copy-chain",
        rationale: "Копия того же оригинала. Отдельная цепочка не возникает.",
        direct: false,
      },
      {
        id: "evidence-birth-conflict",
        targetId: "claim-birth-1898",
        sourceId: "source-census",
        artifactId: "artifact-census",
        polarity: "contradicts",
        locator: "Лист 4",
        excerpt: "Алексей Ветров, год рождения: 1900.",
        independenceGroup: "census-chain",
        rationale: "Конфликт года; личность ещё нужно сверить.",
        direct: false,
      },
      {
        id: "evidence-census",
        targetId: "claim-birth-1900",
        sourceId: "source-census",
        artifactId: "artifact-census",
        polarity: "supports",
        locator: "Лист 4",
        excerpt: "Алексей Ветров, год рождения: 1900.",
        independenceGroup: "census-chain",
        rationale: "Год записан в синтетической карточке.",
        direct: false,
      },
      {
        id: "evidence-census-conflict",
        targetId: "claim-birth-1900",
        sourceId: "source-birth",
        artifactId: "artifact-birth",
        polarity: "contradicts",
        locator: "Лист 12",
        excerpt: "Алексей Ветров, рождение: 1898 год.",
        independenceGroup: "birth-chain",
        rationale: "Первая запись даёт другой год.",
        direct: true,
      },
      {
        id: "evidence-place",
        targetId: "claim-place",
        sourceId: "source-census",
        artifactId: "artifact-census",
        polarity: "supports",
        locator: "Лист 4",
        excerpt: "Проживает в вымышленном Луговом.",
        independenceGroup: "census-place-chain",
        rationale: "Прямое указание места в демонстрационном документе.",
        direct: true,
      },
      {
        id: "evidence-parent-lead",
        targetId: "relationship-parent",
        sourceId: "source-memory",
        artifactId: "artifact-memory",
        polarity: "lead",
        locator: "Страница 1",
        excerpt: "Пётр Ветров жил рядом с Алексеем.",
        independenceGroup: "memory-chain",
        rationale:
          "Родство не упомянуто. Требуется отдельная запись о родителях.",
        direct: false,
      },
    ],
    reviews: [
      {
        id: "review-place",
        targetId: "claim-place",
        decision: "accepted",
        reason:
          "Сохраняем прочтение карточки; степень доказательности остаётся «один источник».",
        reviewer: "demo-reviewer",
        createdAt: date,
        evidenceStatusAtDecision: "single-source",
      },
    ],
    questions: [
      {
        id: "question-birth",
        personId: "person-alexey",
        question: "В каком году родился Алексей Ветров?",
        known:
          "В синтетической записи — 1898; в карточке — 1900. Однофамилец 1911 года хранится отдельно.",
        place: "Луговое (вымышленное)",
        period: "1897–1901",
        plan: "1. Сверить полные записи и происхождение копии.\n2. Проверить варианты имени и родителей.\n3. Найти независимую запись.\n4. Сохранить противоречия и ограничения.",
        status: "open",
        sourceIds: ["source-birth", "source-census"],
        outcome: "",
        limitations: "",
        archivistDraft: "",
        synthetic: true,
      },
    ],
    runs: [
      {
        id: "run-demo",
        questionId: "question-birth",
        mode: "demo",
        action: "Добавлен синтетический пример конфликтующих записей",
        coverage:
          "Только встроенные демонстрационные файлы. Архивы не проверялись.",
        outcome: "found",
        notes: "Это fixture, а не результат онлайн-поиска или вызова ИИ.",
        sourceIds: ["source-birth", "source-census"],
        createdAt: date,
      },
    ],
    positions: {
      "person-petr": { x: 300, y: 30 },
      "person-alexey": { x: 300, y: 300 },
      "person-maria": { x: 640, y: 300 },
      "person-namesake": { x: 980, y: 30 },
      "source-birth": { x: 0, y: 590 },
      "source-birth-copy": { x: 0, y: 800 },
      "source-census": { x: 350, y: 590 },
      "source-memory": { x: 690, y: 590 },
      "claim-birth-1898": { x: -60, y: 300 },
      "claim-birth-1900": { x: 1040, y: 300 },
      "claim-place": { x: 350, y: 800 },
      "question-birth": { x: 690, y: 800 },
    },
  });
}
