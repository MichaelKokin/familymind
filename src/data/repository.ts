import { openDB, type IDBPDatabase } from "idb";
import { DomainError, parseWorkspace, type Workspace } from "../domain/model";
import { validateWorkspaceFiles } from "./files";

/** One active local workspace. Transactions guard against stale tabs and partial writes. */
export class WorkspaceRepository {
  private connection?: Promise<IDBPDatabase>;
  constructor(private readonly databaseName = "family-mind-m0") {}

  private db() {
    if (!this.connection)
      this.connection = openDB(this.databaseName, 1, {
        upgrade(db) {
          db.createObjectStore("workspaces");
        },
        blocking: () => {
          void this.close();
        },
      });
    return this.connection;
  }

  async load(): Promise<Workspace | null> {
    const stored = await (await this.db()).get("workspaces", "active");
    if (stored === undefined) return null;
    try {
      const workspace = parseWorkspace(stored);
      validateWorkspaceFiles(workspace);
      return workspace;
    } catch {
      throw new DomainError("STORAGE_CORRUPT");
    }
  }

  async save(
    workspace: Workspace,
    expectedRevision: number | null,
  ): Promise<Workspace> {
    const validated = parseWorkspace(workspace);
    validateWorkspaceFiles(validated);
    const db = await this.db();
    const tx = db.transaction("workspaces", "readwrite");
    const current = (await tx.store.get("active")) as Workspace | undefined;
    if ((current?.revision ?? null) !== expectedRevision) {
      tx.abort();
      await tx.done.catch(() => undefined);
      throw new DomainError("STALE_REVISION");
    }
    const saved = {
      ...validated,
      revision: (current?.revision ?? 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    await tx.store.put(saved, "active");
    await tx.done;
    return saved;
  }

  async close(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    if (connection) (await connection).close();
  }
}
