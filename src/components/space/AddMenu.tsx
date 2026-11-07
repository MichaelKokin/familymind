"use client";

import { Fragment, useEffect, useRef } from "react";
import { spaceText as s } from "@/i18n/space";
import styles from "@/app/case/explore/space.module.css";
import { template } from "./space-client";

export type AddOption = "parent" | "partner" | "child" | "other" | "relationship" | "photo" | "document" | "link" | "note" | "lead";
const groups: Array<{ label: string; options: AddOption[] }> = [
  { label: s.addGroups.people, options: ["parent", "partner", "child", "other", "relationship"] },
  { label: s.addGroups.materials, options: ["photo", "document", "link", "note"] },
  { label: s.addGroups.research, options: ["lead"] },
];

/** One primary action for the whole canvas: everything is added for the selected person (or the owner). */
export default function AddMenu({ anchorName, canRelate, disabled, onPick }: { anchorName: string; canRelate: boolean; disabled: boolean; onPick: (option: AddOption) => void }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (ref.current?.open && event.target instanceof Node && !ref.current.contains(event.target)) ref.current.open = false; };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);
  const pick = (option: AddOption) => { if (ref.current) ref.current.open = false; onPick(option); };
  return (
    <details ref={ref} className={styles.fab} data-testid="add-menu">
      <summary>＋ {s.addMenu}{anchorName ? ` · ${template(s.addFor, { name: anchorName })}` : ""}</summary>
      <div className={styles.menuList} role="menu" aria-label={s.addMenu}>
        {groups.map((group) => (
          <Fragment key={group.label}>
            <span className={styles.menuGroup}>{group.label}</span>
            {group.options.filter((option) => option !== "relationship" || canRelate).map((option) => (
              <button key={option} type="button" role="menuitem" disabled={disabled} onClick={() => pick(option)}>{s.add[option]}</button>
            ))}
          </Fragment>
        ))}
      </div>
    </details>
  );
}
