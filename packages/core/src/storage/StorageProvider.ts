import type { Project } from "../types.js";

/** Summary shown in the projects list, without loading the full project. */
export interface ProjectMeta {
  id: string;
  name: string;
  /** ISO timestamp */
  updatedAt: string;
  poursCount: number;
}

/**
 * Storage backend contract (spec 12.1). Swapping IndexedDB for the REST API
 * is meant to be a one-line config change — every consumer codes against
 * this interface, never against a concrete provider.
 *
 * Methods are async: both real implementations (IndexedDB, HTTP) are
 * inherently asynchronous, unlike the synchronous sketch in the spec.
 */
export interface StorageProvider {
  list(): Promise<ProjectMeta[]>;
  load(id: string): Promise<Project>;
  /** upsert */
  save(project: Project): Promise<void>;
  duplicate(id: string, newName: string): Promise<Project>;
  remove(id: string): Promise<void>;
}
