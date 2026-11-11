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
  template: `
    <div class="wrap">
      <header>
        <h1>CiteCode</h1>
        <p class="tag">Ask any repo a question. Get answers with file and line citations.</p>
      </header>

      <section class="card">
        <div class="index-row">
          <input #fileInput type="file" accept=".zip,application/zip" hidden (change)="onFile($event)" />
          <button type="button" class="icon" aria-label="Attach a ZIP file" title="Upload a ZIP of a project"
                  [disabled]="indexing()" (click)="fileInput.click()">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
          </button>

          @if (zipFile(); as f) {
            <div class="file-chip">
              <span>{{ f.name }}</span>
              <button type="button" class="x" aria-label="Remove file" (click)="zipFile.set(null)">×</button>
            </div>
          } @else {
            <input type="text" placeholder="https://github.com/owner/repo" aria-label="GitHub repository URL"
                   [value]="url()" [disabled]="indexing()"
                   (input)="url.set($any($event.target).value)" (keydown.enter)="index()" />
          }

          <button type="button" class="primary" [disabled]="!canIndex()" (click)="index()">
            {{ indexing() ? 'Indexing...' : 'Index' }}
          </button>
        </div>

        @if (indexing()) {
          <p class="hint">Indexing... larger repos can take a minute or two.</p>
        } @else {
          <p class="hint">Public GitHub repos only, or a ZIP up to 25 MB.</p>
        }
        @if (indexInfo()) { <p class="info">{{ indexInfo() }}</p> }
        @if (indexError()) { <p class="err">{{ indexError() }}</p> }
      </section>

      <section class="card chat">
        <div class="repo-row">
          <label for="repo">Repository</label>
          <select id="repo" [disabled]="repos().length === 0 || busy()" (change)="onRepo($any($event.target).value)">
            @for (r of repos(); track r.repoId) {
              <option [value]="r.repoId" [selected]="r.repoId === repoId()">{{ r.repoId }} ({{ r.files }} files)</option>
            }
          </select>
          <button type="button" class="link" [disabled]="busy() || messages().length === 0" (click)="clearChat()">
            Clear chat
          </button>
        </div>

        <div class="scroller" #scroller>
          @if (messages().length === 0) {
            <div class="empty">
              @if (repoId()) {
                <p>Ask a question about <strong>{{ repoId() }}</strong>.</p>
                <div class="samples">
                  @for (s of samples; track s) {
                    <button type="button" class="sample" [disabled]="busy()" (click)="send(s)">{{ s }}</button>
                  }
                </div>
              } @else {
                <p>Index a public GitHub repo or upload a ZIP to start. Every answer cites the file and lines it came from.</p>
              }
            </div>
          }

          @for (m of messages(); track $index; let i = $index) {
            <div class="msg" [class.user]="m.role === 'user'" [class.assistant]="m.role === 'assistant'" [class.warn]="isNotFound(m)">
              @if (m.role === 'user') {
                <span>{{ m.text }}</span>
              } @else {
                @if (m.status) {
                  <div class="status"><span class="dot"></span><span>{{ m.status }}</span></div>
                }
                @for (s of segments(m.text); track $index) {
                  @if (s.kind === 'cite') {
                    <button type="button" class="cite" [class.bad]="isUnverified(m, s)"
                            [title]="isUnverified(m, s) ? 'Could not verify these lines in the repo' : 'View ' + s.value"
                            (click)="openCitation(s)">{{ shortCite(s) }}</button>
                  } @else if (s.kind === 'bold') {
                    <strong>{{ s.value }}</strong>
                  } @else if (s.kind === 'code') {
                    <code>{{ s.value }}</code>
                  } @else {
                    <span>{{ s.value }}</span>
                  }
                }
                @if (m.error) { <div class="err">{{ m.error }}</div> }
                @if (m.stats; as st) {
                  <div class="stats">{{ statsLine(st) }}</div>
                  @if (st.toolCalls.length) {
                    <details class="trace">
                      <summary>How I found this</summary>
                      <ol>
                        @for (t of st.toolCalls; track $index) {
                          <li>{{ describeCall(t) }}</li>
                        }
                      </ol>
                    </details>
                  }
                }
                @if (m.done && m.text) {
                  <div class="msg-actions">
                    <button type="button" class="link" (click)="copy(m, i)">
                      {{ copiedIdx() === i ? 'Copied' : 'Copy answer' }}
                    </button>
                  </div>
                }
              }
            </div>
          }
        </div>

        @if (viewer(); as v) {
          <div class="viewer">
            <div class="viewer-head">
              <code>{{ v.title }}</code>
              <button type="button" class="x" aria-label="Close" (click)="viewer.set(null)">×</button>
            </div>
            @if (v.loading) {
              <p class="hint">Loading...</p>
            } @else if (v.error) {
              <p class="err">{{ v.error }}</p>
            } @else {
              <pre>{{ v.text }}</pre>
            }
          </div>
        }

        <div class="ask-row">
          <input type="text" placeholder="Ask about this repository" aria-label="Your question"
                 [value]="draft()" [disabled]="!repoId()"
                 (input)="draft.set($any($event.target).value)" (keydown.enter)="send()" />
          @if (busy()) {
            <button type="button" class="primary" (click)="stop()">Stop</button>
          } @else {
            <button type="button" class="primary" [disabled]="!repoId() || !draft().trim()" (click)="send()">Ask</button>
          }
        </div>
      </section>
    </div>
  `,
  styles: [`
    :host { display: block; min-height: 100vh; color: #1b1f24;
            font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
    .wrap { max-width: 900px; margin: 0 auto; padding: 20px 16px 28px; display: flex; flex-direction: column; gap: 14px; }
    h1 { margin: 0; font-size: 28px; letter-spacing: -0.5px; }
    .tag { margin: 4px 0 0; color: #5b6572; }
    .card { background: #fff; border: 1px solid #e3e6ea; border-radius: 12px; padding: 12px; }
    .index-row, .ask-row, .repo-row { display: flex; gap: 8px; align-items: center; }
    input[type='text'] { flex: 1; min-width: 0; padding: 10px 12px; border: 1px solid #cfd5dc; border-radius: 8px; font-size: 15px; }
    input[type='text']:focus, select:focus { outline: 2px solid #0f766e55; border-color: #0f766e; }
    button { font: inherit; }
    .primary { background: #0f766e; color: #fff; border: 0; border-radius: 8px; padding: 10px 16px; font-size: 15px; cursor: pointer; }
    .primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .icon { width: 42px; height: 42px; display: grid; place-items: center; border: 1px solid #cfd5dc; background: #fff;
            border-radius: 8px; color: #3b4450; cursor: pointer; }
    .icon:disabled { opacity: 0.5; cursor: not-allowed; }
    .file-chip { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: 8px;
                 padding: 9px 12px; border: 1px solid #b7e0d8; background: #e6f4f1; border-radius: 8px; }
    .file-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .x { border: 0; background: transparent; font-size: 20px; line-height: 1; cursor: pointer; color: #5b6572; }
    .hint { margin: 8px 0 0; font-size: 13px; color: #6b7684; }
    .info { margin: 8px 0 0; font-size: 13px; color: #0b5c55; }
    .err { margin: 8px 0 0; font-size: 13px; color: #b42318; }
    .chat { display: flex; flex-direction: column; height: 62vh; min-height: 380px; }
    .repo-row { margin-bottom: 8px; font-size: 14px; color: #5b6572; }
    select { flex: 1; min-width: 0; padding: 8px; border: 1px solid #cfd5dc; border-radius: 8px; font-size: 14px; background: #fff; }
    .scroller { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 12px; padding: 4px; }
    .empty { margin: auto; text-align: center; color: #5b6572; max-width: 480px; }
    .samples { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin-top: 10px; }
    .sample { border: 1px solid #cfd5dc; background: #fff; border-radius: 999px; padding: 6px 12px; font-size: 13px; cursor: pointer; }
    .sample:hover:not(:disabled) { border-color: #0f766e; color: #0f766e; }
    .msg { max-width: 92%; padding: 10px 12px; border-radius: 12px; line-height: 1.55; white-space: pre-wrap; word-break: break-word; }
    .msg.user { align-self: flex-end; background: #0f766e; color: #fff; }
    .msg.assistant { align-self: flex-start; background: #f1f3f5; }
    .msg.assistant.warn { background: #fff7e6; border: 1px solid #f0d9a8; }
    .cite { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; background: #e6f4f1; color: #0b5c55;
            border: 1px solid #b7e0d8; border-radius: 6px; padding: 1px 6px; margin: 0 2px; cursor: pointer; }
    .cite:hover { background: #cfeae4; }
    .cite.bad { background: #fdecea; color: #b42318; border-color: #f4b8b1; text-decoration: line-through; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #e8ebee; padding: 1px 5px; border-radius: 4px; font-size: 0.9em; }
    .status { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #5b6572; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #0f766e; animation: pulse 1s infinite; }
    @keyframes pulse { 50% { opacity: 0.25; } }
    .stats { margin-top: 6px; font-size: 12px; color: #6b7684; }
    .trace, .msg-actions { white-space: normal; }
    .trace { margin-top: 6px; font-size: 12.5px; color: #5b6572; }
    .trace summary { cursor: pointer; }
    .trace ol { margin: 4px 0 0; padding-left: 18px; }
    .msg-actions { margin-top: 4px; }
    .link { border: 0; background: transparent; color: #0f766e; cursor: pointer; font-size: 12.5px; padding: 2px 4px; }
    .link:disabled { opacity: 0.5; cursor: not-allowed; }
    .viewer { border-top: 1px solid #e3e6ea; margin-top: 8px; padding-top: 8px; }
    .viewer-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; }
    .viewer pre { max-height: 220px; overflow: auto; background: #0f172a; color: #e2e8f0; padding: 10px; border-radius: 8px;
                  font-size: 12.5px; margin: 6px 0 0; white-space: pre; }
    .ask-row { margin-top: 10px; }
    @media (max-width: 560px) { .index-row { flex-wrap: wrap; } .chat { height: 68vh; } }
  `],
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