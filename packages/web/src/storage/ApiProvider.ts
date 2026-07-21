import type { Project, ProjectMeta, StorageProvider } from "@rastoplan/core";

// Stub — the real REST-backed implementation lands in Milestone 3, once
// /api/projects and Postgres are wired up.
export class ApiProvider implements StorageProvider {
  constructor(private readonly baseUrl: string) {}

  list(): Promise<ProjectMeta[]> {
    throw new Error("not implemented: ApiProvider.list");
  }

  load(_id: string): Promise<Project> {
    throw new Error("not implemented: ApiProvider.load");
  }

  save(_project: Project): Promise<void> {
    throw new Error("not implemented: ApiProvider.save");
  }

  duplicate(_id: string, _newName: string): Promise<Project> {
    throw new Error("not implemented: ApiProvider.duplicate");
  }

  remove(_id: string): Promise<void> {
    throw new Error("not implemented: ApiProvider.remove");
  }
}
