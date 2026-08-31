import type { Project, ProjectMeta, StorageProvider } from "@rastoplan/core";

export class ApiProvider implements StorageProvider {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.trim().replace(/\/+$/, "");
  }

  async list(): Promise<ProjectMeta[]> {
    return this.requestJson<ProjectMeta[]>("/api/projects");
  }

  async load(id: string): Promise<Project> {
    return this.requestJson<Project>(this.projectPath(id));
  }

  async save(project: Project): Promise<void> {
    await this.request(this.projectPath(project.id), {
      method: "PUT",
      body: JSON.stringify(project),
    });
  }

  async duplicate(id: string, newName: string): Promise<Project> {
    return this.requestJson<Project>(`${this.projectPath(id)}/duplicate`, {
      method: "POST",
      body: JSON.stringify({ name: newName }),
    });
  }

  async remove(id: string): Promise<void> {
    await this.request(this.projectPath(id), { method: "DELETE" });
  }

  private projectPath(id: string): string {
    return `/api/projects/${encodeURIComponent(id)}`;
  }

  private async requestJson<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.request(path, init);
    const body = await response.text();
    if (!body.trim()) {
      throw new Error(`API returned an empty response for ${init?.method ?? "GET"} ${path}`);
    }

    try {
      return JSON.parse(body) as T;
    } catch {
      throw new Error(`API returned invalid JSON for ${init?.method ?? "GET"} ${path}`);
    }
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    headers.set("Accept", "application/json");
    if (init?.body !== undefined && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers,
      credentials: "include",
    });
    if (response.ok) return response;

    const detail = await readErrorDetail(response);
    const status = `${response.status}${response.statusText ? ` ${response.statusText}` : ""}`;
    throw new Error(`API request failed (${status})${detail ? `: ${detail}` : ""}`);
  }
}

async function readErrorDetail(response: Response): Promise<string> {
  const body = await response.text();
  if (!body.trim()) return "";

  try {
    const parsed = JSON.parse(body) as unknown;
    if (isRecord(parsed)) {
      if (typeof parsed.error === "string") return parsed.error;
      if (typeof parsed.message === "string") return parsed.message;
    }
  } catch {
    // Plain-text server and proxy errors are still useful to the user.
  }
  return body.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
