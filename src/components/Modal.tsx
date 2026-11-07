"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export interface ModalProps {
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}

const focusableSelector = [
  "a[href]",
  "button",
  'input:not([type="hidden"])',
  "select",
  "textarea",
  "[tabindex]",
  '[contenteditable="true"]',
  "summary",
  "audio[controls]",
  "video[controls]",
].join(",");

function focusableElements(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(focusableSelector)].filter(
    (element) => {
      const style = getComputedStyle(element);
      return (
        element.tabIndex >= 0 &&
        !element.matches(":disabled") &&
        !element.closest("[inert]") &&
        !element.closest("[hidden]") &&
        style.visibility !== "hidden" &&
        style.visibility !== "collapse" &&
        element.getClientRects().length > 0
      );
    },
  );
}

export function Modal({ title, onClose, busy = false, children }: ModalProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  // Capture the trigger before descendant autoFocus controls receive focus.
  const [returnFocus] = useState<HTMLElement | null>(() =>
    typeof document !== "undefined" &&
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );

  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = busy;
  }, [onClose, busy]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    const focusFirst = () =>
      (focusableElements(dialog)[0] ?? dialog).focus({ preventScroll: true });
    if (!dialog.contains(document.activeElement)) focusFirst();

    const containFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target))
        focusFirst();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (!busyRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusableElements(dialog);
      if (!elements.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      const focused = document.activeElement;
      if (!dialog.contains(focused) || focused === dialog) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && focused === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", containFocus, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", containFocus, true);
      if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    };
  }, [returnFocus]);

  return (
    <div className="modal-backdrop">
      <section
        ref={dialogRef}
        className="modal compact"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-busy={busy}
        tabIndex={-1}
      >
        {children}
      </section>
    </div>
  );
}

export default Modal;
