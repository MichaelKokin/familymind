import { describe, expect, it, vi } from "vitest";
// @ts-expect-error The macOS operator script is intentionally plain Node.js.
import { ensureLocalServer } from "../scripts/local-server.mjs";

describe("local launcher preserves the existing server and access boundary", () => {
  it("reuses an owned responsive server without starting another process", async () => {
    const start = vi.fn();
    const ready = vi.fn().mockResolvedValue(true);
    await ensureLocalServer("/synthetic/checkout", { inspect: vi.fn().mockResolvedValue({ owned: true, pid: 101 }), ready, start });
    expect(start).not.toHaveBeenCalled();
    expect(ready).toHaveBeenCalledOnce();
  });

  it("refuses a foreign listener before checking HTTP or starting anything", async () => {
    const start = vi.fn(), ready = vi.fn();
    await expect(ensureLocalServer("/synthetic/checkout", { inspect: vi.fn().mockResolvedValue({ owned: false }), ready, start })).rejects.toThrow("занят другим приложением");
    expect(start).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
  });

  it("starts a stopped app and waits for the same owned process", async () => {
    const inspect = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue({ owned: true, pid: 202 });
    const start = vi.fn().mockResolvedValue(202), pause = vi.fn();
    await ensureLocalServer("/synthetic/checkout", { inspect, start, pause, ready: vi.fn().mockResolvedValue(true) });
    expect(start).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledOnce();
  });

  it("refuses a listener replacement before allowing sign-in", async () => {
    const inspect = vi.fn().mockResolvedValueOnce({ owned: true, pid: 303 }).mockResolvedValue({ owned: true, pid: 404 });
    const ready = vi.fn();
    await expect(ensureLocalServer("/synthetic/checkout", { inspect, ready })).rejects.toThrow("Процесс на порту 3000 изменился");
    expect(ready).not.toHaveBeenCalled();
  });
});
