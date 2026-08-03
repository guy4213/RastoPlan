import type { Project, ProjectMeta, StorageProvider } from "@rastoplan/core";

const DB_NAME = "rastoplan";
const DB_VERSION = 1;
const STORE = "projects";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txPromise<T>(db: IDBDatabase, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Local IndexedDB persistence for the Milestone 2 canvas. Real REST/API
 * persistence lands with the server work — swapping this for ApiProvider
 * is a one-line change in ProjectContext because both implement
 * StorageProvider.
 */
export class IndexedDBProvider implements StorageProvider {
  async list(): Promise<ProjectMeta[]> {
    const db = await openDb();
    const projects = await txPromise<Project[]>(db, "readonly", (store) => store.getAll() as IDBRequest<Project[]>);
    return projects.map((p) => ({
      id: p.id,
      name: p.name,
      updatedAt: p.updatedAt,
      poursCount: p.pours.length,
    }));
  }

  async load(id: string): Promise<Project> {
    const db = await openDb();
    const project = await txPromise<Project | undefined>(db, "readonly", (store) =>
      store.get(id) as IDBRequest<Project | undefined>
    );
    if (!project) throw new Error(`project not found: ${id}`);
    return project;
  }

  async save(project: Project): Promise<void> {
    const db = await openDb();
    await txPromise(db, "readwrite", (store) => store.put(project));
  }

  async duplicate(id: string, newName: string): Promise<Project> {
    const original = await this.load(id);
    const copy: Project = {
      ...original,
      id: `${id}-copy-${Date.now()}`,
      name: newName,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.save(copy);
    return copy;
  }

  async remove(id: string): Promise<void> {
    const db = await openDb();
    await txPromise(db, "readwrite", (store) => store.delete(id));
  }
}
