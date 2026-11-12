import { Injectable } from '@angular/core';

const LOCAL_API_URL = 'http://localhost:3000/api';
const PRODUCTION_API_URL = 'https://citecode.onrender.com/api';

export const API_URL =
  typeof location !== 'undefined' && location.hostname === 'localhost' ? LOCAL_API_URL : PRODUCTION_API_URL;

export interface RepoInfo { repoId: string; files: number; chunks: number; }
export interface IngestResult { repoId: string; files: number; chunks: number; truncated: boolean; ms: number; }
export interface AgentStats {
  steps: number;
  toolCalls: { name: string; input: unknown }[];
  chunksRetrieved: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  latencyMs: number;
}
export interface FileSlice { from: number; to: number; total: number; lines: string[]; }
export interface VerifiedCitation { path: string; start: number; end: number; valid: boolean; }
export interface ChatHandlers {
  onStatus: (message: string) => void;
  onToken: (text: string) => void;
  onReset: () => void;
  onDone: (stats: AgentStats, citations: VerifiedCitation[]) => void;
  onError: (message: string) => void;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  async listRepos(): Promise<RepoInfo[]> {
    return this.json(await fetch(`${API_URL}/repos`));
  }

  async ingestUrl(url: string): Promise<IngestResult> {
    return this.json(
      await fetch(`${API_URL}/ingest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
    );
  }

  async ingestZip(file: File): Promise<IngestResult> {
    const form = new FormData();
    form.append('zip', file);
    return this.json(await fetch(`${API_URL}/ingest`, { method: 'POST', body: form }));
  }

  async getFile(repoId: string, path: string, start: number, end: number): Promise<FileSlice> {
    const qs = new URLSearchParams({ repoId, path, start: String(start), end: String(end) });
    return this.json(await fetch(`${API_URL}/file?${qs}`));
  }

  async chat(repoId: string, question: string, h: ChatHandlers, signal?: AbortSignal): Promise<void> {
    const res = await fetch(`${API_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoId, question }),
      signal,
    });
    if (!res.ok || !res.body) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Request failed (${res.status})`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) this.dispatch(part, h);
    }
  }

  private dispatch(part: string, h: ChatHandlers) {
    const event = /^event: (.*)$/m.exec(part)?.[1];
    const raw = /^data: (.*)$/m.exec(part)?.[1];
    if (!event) return;
    let data: any = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      return;
    }
    if (event === 'status') h.onStatus(data.message);
    else if (event === 'token') h.onToken(data.text);
    else if (event === 'reset') h.onReset();
    else if (event === 'done') h.onDone(data.stats, data.citations ?? []);
    else if (event === 'error') h.onError(data.message);
  }

  private async json<T>(res: Response): Promise<T> {
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Request failed (${res.status})`);
    }
    return res.json();
  }
}