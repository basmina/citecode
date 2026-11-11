import { ChangeDetectionStrategy, Component, ElementRef, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { AgentStats, ApiService, RepoInfo, VerifiedCitation } from './api.service';

const MAX_ZIP_BYTES = 25 * 1024 * 1024;

interface Message {
  role: 'user' | 'assistant';
  text: string;
  status: string;
  done: boolean;
  stats?: AgentStats;
  citations?: VerifiedCitation[];
  error?: string;
}

interface Segment {
  kind: 'text' | 'bold' | 'code' | 'cite';
  value: string;
  path?: string;
  start?: number;
  end?: number;
}

interface Viewer { title: string; text: string; loading: boolean; error: string; }

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './citecode.component.html',
  styleUrls: ['./citecode.component.css']
})
export class CiteCodeComponent implements OnInit {
  private readonly api = inject(ApiService);
  private abort: AbortController | null = null;
  @ViewChild('scroller') private scroller?: ElementRef<HTMLElement>;

  readonly samples = [
    'What does this project do?',
    'How is the project structured?',
    'Where is routing configured?',
    'How does authentication work?',
    'Which services call an API?',
  ];

  url = signal('');
  zipFile = signal<File | null>(null);
  indexing = signal(false);
  indexInfo = signal('');
  indexError = signal('');

  repos = signal<RepoInfo[]>([]);
  repoId = signal('');

  messages = signal<Message[]>([]);
  draft = signal('');
  busy = signal(false);
  viewer = signal<Viewer | null>(null);
  copiedIdx = signal(-1);

  canIndex = computed(() => !this.indexing() && (!!this.zipFile() || this.url().trim().length > 0));

  async ngOnInit() {
    try {
      await this.refreshRepos();
    } catch {
      this.indexError.set('Cannot reach the CiteCode API. Is the server running on port 3000?');
    }
  }

  private async refreshRepos(select?: string) {
    const list = await this.api.listRepos();
    this.repos.set(list);
    if (select) this.selectRepo(select);
    else if (!this.repoId() && list.length > 0) this.selectRepo(list[0].repoId);
  }

  private selectRepo(id: string) {
    this.repoId.set(id);
    this.messages.set([]);
    this.viewer.set(null);
  }

  onRepo(id: string) {
    this.selectRepo(id);
  }

  clearChat() {
    this.messages.set([]);
    this.viewer.set(null);
  }

  onFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) {
      this.indexError.set('Please choose a .zip file.');
      return;
    }
    if (file.size > MAX_ZIP_BYTES) {
      this.indexError.set('ZIP is too large (limit 25 MB).');
      return;
    }
    this.indexError.set('');
    this.zipFile.set(file);
  }

  async index() {
    if (!this.canIndex()) return;
    this.indexError.set('');
    this.indexInfo.set('');
    this.indexing.set(true);
    try {
      const file = this.zipFile();
      const r = file ? await this.api.ingestZip(file) : await this.api.ingestUrl(this.url());
      await this.refreshRepos(r.repoId);
      this.indexInfo.set(
        `Indexed ${r.repoId}: ${r.files} files, ${r.chunks} chunks in ${(r.ms / 1000).toFixed(1)}s` +
          (r.truncated ? ' (large repo: only part of it was indexed)' : '')
      );
      this.zipFile.set(null);
      this.url.set('');
    } catch (e) {
      this.indexError.set(e instanceof Error ? e.message : 'Indexing failed.');
    } finally {
      this.indexing.set(false);
    }
  }

  async send(preset?: string) {
    const q = (preset ?? this.draft()).trim();
    if (!q || !this.repoId() || this.busy()) return;

    this.draft.set('');
    this.viewer.set(null);
    this.messages.update((ms) => [
      ...ms,
      { role: 'user', text: q, status: '', done: true },
      { role: 'assistant', text: '', status: 'Thinking...', done: false },
    ]);
    this.busy.set(true);
    this.abort = new AbortController();
    this.scrollSoon();

    const patch = (fn: (m: Message) => Message) =>
      this.messages.update((ms) => [...ms.slice(0, -1), fn(ms[ms.length - 1])]);

    try {
      await this.api.chat(
        this.repoId(),
        q,
        {
          onStatus: (s) => patch((m) => ({ ...m, status: s })),
          onToken: (t) => {
            patch((m) => ({ ...m, text: m.text + t, status: '' }));
            this.scrollSoon();
          },
          onReset: () => patch((m) => ({ ...m, text: '' })),
          onDone: (stats, citations) => patch((m) => ({ ...m, stats, citations, status: '', done: true })),
          onError: (msg) => patch((m) => ({ ...m, error: msg, status: '', done: true })),
        },
        this.abort.signal
      );
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      patch((m) => ({
        ...m,
        status: '',
        done: true,
        error: aborted ? undefined : e instanceof Error ? e.message : 'Request failed.',
      }));
    } finally {
      this.busy.set(false);
      this.abort = null;
    }
  }

  stop() {
    this.abort?.abort();
  }

  async openCitation(s: Segment) {
    if (!s.path || !s.start || !s.end) return;
    const title = s.value;
    this.viewer.set({ title, text: '', loading: true, error: '' });
    try {
      const f = await this.api.getFile(this.repoId(), s.path, s.start, s.end);
      this.viewer.set({ title, text: f.lines.join('\n'), loading: false, error: '' });
    } catch (e) {
      this.viewer.set({
        title,
        text: '',
        loading: false,
        error: e instanceof Error ? e.message : 'Could not load the file.',
      });
    }
  }

  segments(text: string): Segment[] {
    const out: Segment[] = [];
    const re = /\[([^\s\[\],;:]+:\d+(?:-\d+)?(?:\s*[,;]\s*[^\s\[\],;:]+:\d+(?:-\d+)?)*)\]|\*\*([^*]+)\*\*|`([^`]+)`/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      if (m.index > last) out.push({ kind: 'text', value: text.slice(last, m.index) });
      if (m[1]) {
        for (const part of m[1].split(/\s*[,;]\s*/)) {
          const c = /^(.+):(\d+)(?:-(\d+))?$/.exec(part);
          if (!c) continue;
          const start = +c[2];
          const end = c[3] ? +c[3] : start;
          out.push({ kind: 'cite', value: `${c[1]}:${start}-${end}`, path: c[1], start, end });
        }
      } else if (m[2]) {
        out.push({ kind: 'bold', value: m[2] });
      } else {
        out.push({ kind: 'code', value: m[3] });
      }
      last = re.lastIndex;
    }
    if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
    return out;
  }

  shortCite(s: Segment): string {
    return `${(s.path ?? '').split('/').pop()}:${s.start}-${s.end}`;
  }

  isNotFound(m: Message): boolean {
    return m.role === 'assistant' && m.text.trimStart().startsWith('Not found in this repo');
  }

  isUnverified(m: Message, s: Segment): boolean {
    return !!m.citations?.some((c) => !c.valid && c.path === s.path && c.start === s.start && c.end === s.end);
  }

  describeCall(t: { name: string; input: unknown }): string {
    const i = (t.input ?? {}) as Record<string, unknown>;
    if (t.name === 'search_code') return `Searched the code for "${String(i['query'] ?? '')}"`;
    if (t.name === 'read_file') {
      return `Read ${String(i['path'] ?? '')}` + (i['start_line'] ? ` (lines ${i['start_line']}-${i['end_line'] ?? ''})` : '');
    }
    if (t.name === 'list_files') return 'Listed files' + (i['prefix'] ? ` under ${String(i['prefix'])}` : '');
    return t.name;
  }

  async copy(m: Message, i: number) {
    try {
      await navigator.clipboard.writeText(m.text);
      this.copiedIdx.set(i);
      setTimeout(() => this.copiedIdx.set(-1), 1500);
    } catch {
      /* clipboard blocked by the browser: nothing to do */
    }
  }

  statsLine(s: AgentStats): string {
    const read = s.cacheReadTokens ?? 0;
    const input = s.inputTokens + read + (s.cacheCreationTokens ?? 0);
    const cached = input ? ` (${Math.round((100 * read) / input)}% cached)` : '';
    return `${s.steps} steps · ${s.toolCalls.length} tool calls · ${s.chunksRetrieved} chunks · ` +
      `${input + s.outputTokens} tokens${cached} · ${(s.latencyMs / 1000).toFixed(1)}s`;
  }

  private scrollSoon() {
    requestAnimationFrame(() => {
      const el = this.scroller?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}