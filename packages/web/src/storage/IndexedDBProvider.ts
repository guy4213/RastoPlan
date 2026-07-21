import type { Project, ProjectMeta, StorageProvider } from "@rastoplan/core";

// Stub — real IndexedDB persistence lands when core development needs it
// (spec 12.1: used during early development + as an offline fallback).
export class IndexedDBProvider implements StorageProvider {
  list(): Promise<ProjectMeta[]> {
    throw new Error("not implemented: IndexedDBProvider.list");
  }

  load(_id: string): Promise<Project> {
    throw new Error("not implemented: IndexedDBProvider.load");
  }

  save(_project: Project): Promise<void> {
    throw new Error("not implemented: IndexedDBProvider.save");
  }

  duplicate(_id: string, _newName: string): Promise<Project> {
    throw new Error("not implemented: IndexedDBProvider.duplicate");
  }

  remove(_id: string): Promise<void> {
    throw new Error("not implemented: IndexedDBProvider.remove");
  }
}
