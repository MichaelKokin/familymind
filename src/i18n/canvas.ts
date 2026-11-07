import type { AriaLabelConfig } from "@xyflow/react";

const directions: Record<string, string> = {
  up: "вверх",
  down: "вниз",
  left: "влево",
  right: "вправо",
};

export const canvasAriaLabels = {
  "node.a11yDescription.default":
    "Нажмите Enter или пробел, чтобы выбрать карточку. Escape снимает выделение.",
  "node.a11yDescription.keyboardDisabled":
    "Нажмите Enter или пробел, чтобы выбрать карточку. Перемещайте выбранную карточку стрелками. Escape снимает выделение.",
  "node.a11yDescription.ariaLiveMessage": ({
    direction,
    x,
    y,
  }: {
    direction: string;
    x: number;
    y: number;
  }) =>
    `Карточка перемещается ${directions[direction] ?? ""}. Положение: по горизонтали ${x}, по вертикали ${y}.`,
  "edge.a11yDescription.default":
    "Нажмите Enter или пробел, чтобы выбрать связь. Escape снимает выделение.",
  "controls.ariaLabel": "Управление Canvas",
  "controls.zoomIn.ariaLabel": "Приблизить",
  "controls.zoomOut.ariaLabel": "Отдалить",
  "controls.fitView.ariaLabel": "Показать все карточки",
  "controls.interactive.ariaLabel":
    "Включить или отключить перемещение карточек",
  "minimap.ariaLabel": "Обзорная карта Canvas",
  "handle.ariaLabel": "Точка связи карточки",
} satisfies Partial<AriaLabelConfig>;
