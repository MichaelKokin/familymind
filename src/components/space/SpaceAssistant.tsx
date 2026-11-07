"use client";

import FamilyChat from "../FamilyChat";
import type { GuideStep } from "@/private-case/space-guide";
import { spaceText as s } from "@/i18n/space";
import styles from "@/app/case/explore/space.module.css";
import { template } from "./space-client";

export const stepTitle = (step: GuideStep) => template(s.guide[step.action].title, { name: step.personName, detail: step.detail });
export const stepDetail = (step: GuideStep) => template(s.guide[step.action].detail, { name: step.personName, detail: step.detail });

/** The compact assistant: one next step, the honest research state and the Codex chat in one place. */
export default function SpaceAssistant({ step, others, hasDismissed, busy, research, chatOpen, chatSeed, onToggleChat, onAct, onSkip, onReset, onOpenSource, onOpenSpaceRecord }: {
  step: GuideStep | null;
  others: GuideStep[];
  hasDismissed: boolean;
  busy: boolean;
  research: { open: number; pending: number };
  chatOpen: boolean;
  chatSeed: { key: number; question: string };
  onToggleChat: () => void;
  onAct: (step: GuideStep) => void;
  onSkip: (step: GuideStep) => void;
  onReset: () => void;
  onOpenSource: (sourceId: string) => void;
  onOpenSpaceRecord: (recordId: string) => void;
}) {
  const active = research.open > 0 || research.pending > 0;
  return (
    <section className={styles.assistant} aria-label={s.guideTitle} data-testid="space-guide">
      <div className={styles.assistantHead}>
        <span className={styles.eyebrow}>{s.guideTitle}</span>
        {active && <span className={styles.assistantChip} data-testid="research-state">{template(s.researchState, { open: String(research.open), pending: String(research.pending) })}</span>}
        <button type="button" className={styles.assistantToggle} onClick={onToggleChat} aria-expanded={chatOpen}>{chatOpen ? s.closeChat : s.openChat}</button>
      </div>
      <div className={styles.assistantBody}>
        {step ? (
          <>
            <div className={styles.assistantStep} data-testid="guide-step">{stepTitle(step)}</div>
            <p className={styles.assistantDetail}>{stepDetail(step)}</p>
            <div className={styles.assistantActions}>
              <button type="button" className={styles.primaryAction} disabled={busy} onClick={() => onAct(step)}>{s.guideDo}</button>
              <button type="button" disabled={busy} onClick={() => onSkip(step)}>{s.guideSkip}</button>
            </div>
            {others.length > 0 && (
              <details className={styles.assistantOther}>
                <summary>{s.guideOther}</summary>
                {others.map((other) => <button key={other.key} type="button" onClick={() => onAct(other)}>{stepTitle(other)}</button>)}
              </details>
            )}
          </>
        ) : (
          <>
            <p className={styles.assistantDetail}>{s.guideNone}</p>
            {hasDismissed && <div className={styles.assistantActions}><button type="button" disabled={busy} onClick={onReset}>{s.guideReset}</button></div>}
          </>
        )}
        {active && <p className={styles.assistantManual}>{s.researchManual}</p>}
        <p className={styles.assistantNote}>{s.guideNote}</p>
      </div>
      {chatOpen && <div className={styles.assistantChat}><FamilyChat key={chatSeed.key} mode="private" onOpenSource={onOpenSource} onOpenSpaceRecord={onOpenSpaceRecord} initialQuestion={chatSeed.question} /></div>}
    </section>
  );
}
