# CiteCode

Ask a question about any public GitHub repository (or an uploaded ZIP) and get an answer that **cites the exact files and line ranges it came from**. Every citation is clickable, and a citation the server cannot verify is shown struck through in red. If the answer is not in the repo, CiteCode says **"Not found in this repo."** instead of guessing.

**Assignment option:** Option 2, Code Documentation Assistant.

| | |
|---|---|
| Live demo | https://citecode-ui.onrender.com |
| API | https://citecode.onrender.com (health check: `/api/health`) |
| Repository | https://github.com/basmina/citecode |
| Video walkthrough | attached in mail |
| Screenshots | see [Screenshots](#screenshots) |

> The demo runs on Render's free tier. The API sleeps after 15 minutes without traffic, so the **first load can take about a minute**. The demo has a repository indexed beforehand (`gothinkster/angular-realworld-example-app`); indexing a new repo on the free instance may be very slow or fail (see section 12).

---

## Table of contents

1. [Why I chose this problem](#1-why-i-chose-this-problem)
2. [What it does](#2-what-it-does)
3. [Quick setup](#3-quick-setup)
4. [Architecture](#4-architecture)
5. [RAG and LLM approach](#5-rag-and-llm-approach)
6. [Why I chose Neon, Claude, and Render (and why Docker only runs in the cloud)](#6-why-i-chose-neon-claude-and-render-and-why-docker-only-runs-in-the-cloud)
7. [Other key technical decisions](#7-other-key-technical-decisions)
8. [Issues I faced and how I fixed them](#8-issues-i-faced-and-how-i-fixed-them)
9. [Engineering standards: followed and skipped](#9-engineering-standards-followed-and-skipped)
10. [Deployment, productionizing and scaling](#10-deployment-productionizing-and-scaling)
11. [How I used AI tools](#11-how-i-used-ai-tools)
12. [Known limitations](#12-known-limitations)
13. [What I would do differently with more time](#13-what-i-would-do-differently-with-more-time)

---

## 1. Why I chose this problem

I picked Option 2 because I have lived this problem. In eleven years I have joined many projects where I did not write the code, and the first days were always the same: finding where things live, who calls what, and where a request really ends up. A Forward Deployed Engineer does this at every client, so being able to find the right file fast, and not trust a guess, is the skill that matters.

I wanted a tool where I can ask "where is the token stored?" and check the answer in seconds. For me, "good" means two things. Every claim comes with a file and a line range I can click. And when the code does not contain the answer, the tool says so. A confident wrong answer is worse than no answer, because I might build on it.

---

## 2. What it does

- Index a **public GitHub repo URL**, or **upload a ZIP** (up to 25 MB). Both go through the same pipeline.
- Ask questions in a chat. Answers **stream** in as Claude writes them.
- Citations look like `file.ts:10-40`. Clicking one opens those lines in a viewer.
- The server **verifies** every citation (the file exists and the range starts inside it). Unverified citations are shown in red and struck through.
- "Not found in this repo" answers get an amber bubble, and the server removes any citations the model added to them.
- Each answer shows its cost: steps, tool calls, chunks, tokens (and how much was cached) and latency.
- A **"How I found this"** panel lists every search and file read the agent did for that answer.
- Copy answer and Clear chat buttons. **Stop** cancels an answer in progress and the chat shows "Interaction stopped by user."

**Questions it is built for:** how a feature works, where something is implemented, which API endpoints or routes exist, which dependencies and scripts the project uses, and how files relate to each other. Examples: "Where is the user token stored?", "What does `npm start` run?", "Which services does the app use?"

**UI/UX choices** (the reasoning behind them):

- **Trust is visible.** Citations are chips you can click, unverifiable ones are red and struck through, and a "Not found" answer has its own amber bubble. The reader can tell at a glance how far to trust each answer.
- **The work is inspectable.** The "How I found this" panel shows each search and file read, and the stats line shows steps, tool calls, chunks, tokens (with the cached share) and latency.
- **It feels responsive.** Answers stream in, there is a Stop button, and status messages show what the agent is doing while it works.
- **Small conveniences:** Copy answer, Clear chat, a repository picker, and clear error messages (for example the GitHub rate limit).

**What is built and working:**

- [x] Ingestion from GitHub URL and ZIP
- [x] Hybrid retrieval (BM25 + pgvector, merged with Reciprocal Rank Fusion)
- [x] Agent loop with tools (`search_code`, `read_file`, `list_files`)
- [x] Guardrails (details in section 5.6)
- [x] Angular chat UI with streaming and clickable citations
- [x] Unit and integration tests (42 tests, LLM and database mocked)
- [x] Eval harness (retrieval comparison plus answer checks)
- [x] Structured logging (pino)
- [x] Dockerfile and GitHub Actions CI
- [x] Deployed on Render (API from the Dockerfile, frontend as a static site, database on Neon)
- [ ] MCP server wrapper (optional in the brief, not built; see section 13)

---

## 3. Quick setup

### Prerequisites

- Node.js 22 and npm
- A Postgres database with the **pgvector** extension (I used a free [Neon](https://neon.tech) database)
- An **Anthropic API key**

### Run it locally

```bash
git clone https://github.com/basmina/citecode.git
cd citecode

# 1. database: run server/schema.sql once in your Postgres SQL editor.
#    The server does not create its table by itself.

# 2. backend
cd server
cp .env.example .env      # then fill in the values below
npm install
npm run dev               # API on http://localhost:3000

# 3. frontend (new terminal)
cd client
npm install
npx ng serve              # UI on http://localhost:4200
```

The UI talks to `http://localhost:3000/api` when it runs on `localhost`, and to the deployed API everywhere else. Both addresses are constants at the top of `client/src/app/api.service.ts`.

### Environment variables (`server/.env`)

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Claude API access |
| `DATABASE_URL` | Postgres connection string (pgvector enabled) |
| `LLM_MODEL` | Optional. Defaults to `claude-haiku-5-5` |
| `MAX_AGENT_STEPS` | Optional. Hard cap on agent steps per question, default 6 |
| `CLIENT_ORIGIN` | The browser address allowed to call the API (CORS). Locally `http://localhost:4200`; in the deployment, the static site's address |
| `PORT` | Set by Render in the deployment; defaults to 3000 locally |
| `GITHUB_TOKEN` | Optional. A read-only GitHub token for public repos. Raises GitHub's API limit from 60 to 5,000 requests per hour. Needed on Render, because the shared outbound IP uses up the anonymous limit |

`.env` is git-ignored. Never commit it.

### Tests, type-check and evals

```bash
cd server
npm test                     # 42 tests, no API key or database needed
npm run typecheck            # strict TypeScript check
npm run eval                 # real API calls: retrieval comparison + answer checks
npm run eval -- --no-llm     # retrieval comparison only, no API cost
```

### Docker

`server/Dockerfile` builds the API (node:22-slim, one stage, production dependencies only, non-root user). I could not run Docker on my laptop, so I never built the image locally. Render builds it from this repo instead. See section 6.3.

---

## 4. Architecture

```mermaid
flowchart LR
  U[Angular UI] -->|question, SSE stream| API[Express API]
  U -->|repo URL or ZIP| ING[Ingestion]

  subgraph Ingestion
    ING --> FILES[Fetch files, skip junk and secrets]
    FILES --> CHUNK[30-line chunks, 6-line overlap]
    CHUNK --> EMB[Local embeddings, 384 dims]
    EMB --> PG[(Postgres + pgvector)]
    CHUNK --> BM25[In-memory BM25 index]
  end

  subgraph Agent
    API --> LOOP[Agent loop, max 6 steps]
    LOOP <-->|tool calls| TOOLS[search_code / read_file / list_files]
    TOOLS --> HYB[Hybrid search + RRF]
    HYB --> PG
    HYB --> BM25
    LOOP <--> CLAUDE[Claude API]
    LOOP --> VERIFY[Citation verifier + refusal check]
  end

  VERIFY -->|answer, verified citations, stats| U
```

### Request flow

1. **Index (once per repo):** download the files, drop junk (`node_modules`, lockfiles, binaries, `.env`), cut each file into 30-line chunks with a 6-line overlap (line numbers are kept so citations stay exact), embed every chunk locally, store it in Postgres, and build the BM25 index in memory.
2. **Ask:** the server sends the question, the system prompt and the three tool definitions to Claude.
3. Claude decides what to call. `search_code` runs hybrid retrieval. `read_file` fetches more lines around a hit. `list_files` shows the structure.
4. My code runs the tool, validates its arguments, and sends the result back to Claude. This repeats until Claude answers or the step cap is reached.
5. Claude writes the answer with citations. The server **verifies the citations**, removes them from any "Not found" answer, and streams the result to the browser.

### Repository layout

```
client/src/app/        Angular standalone component, API service
server/schema.sql      Database table (run once)
server/Dockerfile      API image
server/src/
  server.ts            Express API, SSE streaming, rate limiting
  agent.ts             Agent loop, tools, system prompt, prompt caching
  hybrid.ts, rrf.ts    Hybrid retrieval and Reciprocal Rank Fusion
  bm25.ts              In-memory BM25 (minisearch, camelCase-aware tokenizer)
  store.ts, db.ts      Postgres + pgvector access
  embeddings.ts        Local embedding model
  chunker.ts, files.ts Chunking and file filtering
  ingest.ts            GitHub and ZIP ingestion with safety limits
  citations.ts         Citation parsing
  verify.ts            Server-side citation verification
  refusal.ts           "Not found" detection and citation stripping
  *.test.ts            Unit and integration tests
server/evals/          Eval questions, runner and saved results
.github/workflows/     CI
```

---

## 5. RAG and LLM approach

### 5.1 Component choices

| Component | Considered | Chosen | Why | Trade-off |
|---|---|---|---|---|
| **LLM** | Claude Haiku, Claude Sonnet, other vendors | Claude, Haiku 5.5 by default | See section 6.2. | Haiku is less capable on hard questions. |
| **Vector DB** | Pinecone, Chroma, in-memory | Postgres + pgvector | I wanted vectors and metadata in one database that I can query with plain SQL. Pinecone would have meant another service and another key. | Less specialised at very large scale, which does not matter for one repo at a time. |
| **Postgres host** | Local Postgres, Supabase, Neon | Neon | See section 6.1. | Free-tier limits; another account. |
| **Keyword search** | Elasticsearch, Postgres full-text, in-memory BM25 | `minisearch` BM25 in memory | Elasticsearch is a separate server built for millions of documents. For one repo at a time it is extra setup and cost for no benefit. | The index is lost on restart and rebuilt from Postgres. One instance only. |
| **Retrieval** | Vector only, BM25 only, hybrid | Hybrid with Reciprocal Rank Fusion | Code questions mix exact names (`JwtService`) with vague meaning ("where is the user restored?"). BM25 is better at the first, vectors at the second. RRF merges them without comparing scores that are on different scales. | More moving parts. On my eval, hybrid won hit@1 but vector alone won hit@5. |
| **Embeddings** | Hosted embedding APIs, local model | Local `Xenova/all-MiniLM-L6-v2` (384 dims) | No second API key and no per-call cost. | Lower quality than hosted models, and slow on CPU (75 files took 36.5 s). |
| **Chunking** | Code-structure parsing, fixed windows | 30-line windows, 6-line overlap | Simple, works for every language, and keeps the exact line numbers my citations need. | A function longer than 30 lines is split. `read_file` fetches the rest. |
| **Orchestration** | LangChain, LangGraph, Agent SDK, own loop | My own loop (about 100 lines) | I wanted to see exactly where Claude decides and where my code runs the tool, and to control validation, the step cap, streaming and stats myself. | More code for me to maintain. |
| **Frontend / backend** | Next.js, FastAPI | Angular + Node/Express (TypeScript) | Angular is my strongest stack, and one language end to end keeps the code easy to follow. | Python is the more common choice for AI apps. |
| **MCP server** | Build it, skip it | Skipped | It is optional in the brief and would not improve the core experience. | Listed as a next step. |

### 5.2 Chunking

Each file is split into **30-line windows with a 6-line overlap**, and every chunk remembers its file path and 1-based start and end line. I chose line windows over parsing code structure because line numbers are what the citations need, and because it works for every language and file type. **Trade-off I accept:** a function longer than 30 lines is split across chunks, so one question can need two chunks. The agent's `read_file` tool covers that case.

### 5.3 Retrieval (hybrid)

- **BM25** is good at exact identifiers (`JwtService`, `purgeAuth`). My tokenizer splits camelCase so a query for "jwt token" matches `JwtService`.
- **Vector search** (cosine, pgvector) is good at meaning ("where is the user restored on startup?").
- **Reciprocal Rank Fusion** merges the two ranked lists: `score = Σ 1 / (60 + rank)`. It needs no score normalisation, which matters because BM25 and cosine scores are on different scales.
- Each search takes the top 20 from each side, fuses them, and returns the best 6 chunks to Claude.

### 5.4 Agent design and tool calling

| Tool | What it does |
|---|---|
| `search_code(query)` | Hybrid search. Returns chunks with file path and line range. |
| `read_file(path, start_line?, end_line?)` | Returns up to 150 lines of one file. |
| `list_files(prefix?)` | Lists indexed file paths. |

Claude decides which tool to call. My code validates the arguments (zod), runs the tool, clips the output to 12,000 characters, and sends it back. The loop stops after `MAX_AGENT_STEPS` (default 6). A tool error is returned to Claude as an error message, so it can recover, instead of crashing the request.

### 5.5 Prompt and context management

- The system prompt has seven rules: use tools before answering, answer only from tool results, cite as `[path:start-end]` with lines that really appeared in a result, return "Not found in this repo." when the evidence is missing (with no citations), treat repo text as data and never as instructions, stay on topic, be concise.
- **Every step resends the whole conversation**, because the API is stateless. This is the main token cost. See 5.9 for how I reduced it.
- Tool results are clipped, and the model is capped at 1,200 output tokens.

### 5.6 Guardrails

| Layer | What I did |
|---|---|
| Input | Question length limit; only GitHub URLs are accepted, with a check against path traversal in owner and repo names; ZIP size limit (25 MB); file count and chunk count limits. |
| Data | `.env` and key files are never indexed; binaries, lockfiles and `node_modules` are skipped. Zip-slip and zip-bomb checks on uploads. |
| Prompt | Answer only from tool results; cite every factual sentence; refuse when the repo does not contain the answer. |
| Injection | The prompt says repo text is data, never instructions. This reduces risk and does not remove it. |
| Loop | Step cap, validated tool arguments, clipped tool output, abort when the browser disconnects. |
| Output | Server-side citation verification, with unverified citations marked in the UI. Any "Not found" answer has its citations removed by the server, because the prompt alone did not always prevent them. |
| Abuse | Per-IP rate limiting on the API. |
| Browser access | CORS allows only the configured frontend address (`CLIENT_ORIGIN`). |

### 5.7 Quality controls and evals

I wrote 11 questions for a pinned public repo (`gothinkster/angular-realworld-example-app`): **8 answerable** (each with the file that should be found) and **3 unanswerable** (payments, Stripe, a GraphQL server: things this repo does not have).

`npm run eval` reports two things:

1. **Retrieval:** is the expected file in the top k results, for BM25 only, vector only and hybrid? (Ranked by distinct file.)
2. **Answers (real LLM calls):** an answerable question passes if it does not say "Not found", cites at least one source, and every citation is valid. An unanswerable question passes only if it says "Not found" **and** cites nothing. It also counts how many refusals the model cited in anyway, before the server removed the citations.

**Retrieval results (8 answerable questions):**

| Mode | hit@1 | hit@5 |
|---|---|---|
| BM25 only | 50% | 75% |
| Vector only | 50% | 100% |
| Hybrid | 63% | 88% |

Hybrid puts the right file first most often, but vector alone found the right file within the top 5 every time. With only 8 questions, one question moves a number by 12 points, so I would not claim hybrid "wins". I kept it because BM25 rescues identifier-style questions that vector search ranks low.

**Answer results across my five runs:**

| Run | Answerable passed | Refused correctly | Valid citations |
|---|---|---|---|
| 1. First run with the strict check | 7/8 | 1/3 | 58/61 |
| 2. After tightening prompt + verifier | 8/8 | 3/3 | 43/43 |
| 3. After the caching changes | 8/8 | 2/3 | 44/44 |
| 4. After enforcing "Not found" in code | 8/8 | 3/3 | 34/34 |
| 5. Final run, same code as run 4 | 8/8 | 3/3 | 44/44 |

Run 1 showed two real problems: the model sometimes cited line ranges it had never seen, and refusals still attached citations. I fixed these with stricter prompt rules, the server-side verifier and red marking in the UI. Run 3 showed refusals were still not fully reliable: one correct "Not found" still carried a citation. So I moved that rule into code (the server removes citations from any "Not found" answer).

**Important:** refusal behaviour varies between runs. In run 3 the model cited in 1 of 3 refusals. In run 4 it refused cleanly all three times, so the code guard had nothing to remove. In run 5 it cited again on the GraphQL question (1 of 3), and this time the server removed that citation, so the guard has now worked in a live eval and not only in its 5 unit tests. The eval keeps a separate count of "refusals where the model cited anyway", so the model's own reliability stays visible. `results.json` holds run 5. The earlier runs are kept as `results-baseline.json` (run 2), `results-run3-10of11.json` and `results-run4.json`.

**Honest limits of this eval:**

- Some questions were written after I had seen what the system answers, and I tuned the prompt on the same questions. The numbers are therefore optimistic. I plan to add held-out questions written without looking at the system.
- The verifier checks that the cited file and line range **exist**. It does not check that those lines **support** the claim.
- It is one run per row, and model output varies between runs (see 5.9: cost differed by up to about 30% between runs).
- 11 questions on one repo is a smoke test, not a benchmark.

### 5.8 Observability

- Structured JSON logs (pino): every tool call, and one summary line per answered question with steps, tool calls, chunks, input/output/cache tokens, latency, citation count, invalid-citation count and how many citations were removed from a refusal. On Render these appear in the service's Logs tab.
- A `/api/health` endpoint, also used as Render's health check.
- Secrets and full repo contents are never logged.

### 5.9 How I reduced token usage

**The question that started it.** While reading my first logs I asked why earlier tool results are sent again on every step. The answer: the Messages API is stateless. Claude does not remember the previous step, so each step must resend the question, the system prompt, the tool definitions and every earlier tool result. A question that needs three steps therefore pays for the first search result three times. My baseline was about **14,000 tokens per question**, most of it repeated input.

**What I changed** (only two things, both low risk):

1. **Prompt caching.** I put a cache breakpoint on the system prompt (which also caches the tool definitions) and on the last block of the newest message. Later steps read the earlier steps from the cache at about a tenth of the normal input price. Cache writes cost 1.25x, so it only pays off when there are several steps.
2. **No repeated chunks.** The agent remembers which chunks it has already sent during a question. If a second search returns the same chunk, the result only lists its location and says it was already shown, instead of resending the code.

**How I measured it, and a trap I avoided.** With caching on, the API's `input_tokens` only counts the part that was *not* cached. If I had kept adding only `input + output`, the numbers would have looked far better than they were. So the stats and the eval add the cache reads and writes back, and the eval also reports a billed-equivalent figure (writes at 1.25x, reads at 0.1x).

**Result:**

| | Baseline (before) | Run 3 | Run 4 | Run 5 |
|---|---|---|---|---|
| Avg tokens per question | ~14,000 | 11,571 | 8,296 | 10,733 |
| Avg billed input (cache writes 1.25x, reads 0.1x) | not recorded | 6,740 | 6,165 | 6,724 |
| Avg input that was cached | 0% | 53% | 37% | 45% |

All three runs after the change are below the baseline. But runs 3, 4 and 5 differ by up to about 30% with nearly identical token code, because the model sometimes finishes in 2 steps and sometimes in 4, and writes longer or shorter answers. The baseline was also a single run. So I can say tokens went down, but not by exactly how much. In run 3 the first question also reused a cache I had warmed by hand minutes earlier, which flattered that row. A fair measurement would need several runs per question and an average with a spread, which I list as a next step.

**What I did not do:** I did not tune further (for example 5 chunks per search, or batching searches). Changing several things at once would not show which one helped. Each is a separate experiment for later.

---

## 6. Why I chose Neon, Claude, and Render (and why Docker only runs in the cloud)

### 6.1 Why Neon

I wanted pgvector so vectors and metadata live in one Postgres database. My local Postgres did not have it: when I queried `pg_available_extensions`, it returned 0 rows, and installing and building extensions on a Windows machine would have cost me hours.

Neon gave me what I needed immediately:

- pgvector is available and enabled with one command.
- It is hosted, so the **same database works on my laptop and in the deployment**. I indexed the demo repo once from my laptop, and the deployed API reads the same data.
- The free tier is enough for this project.
- It is plain Postgres, so I am not locked in. Moving to RDS, Aurora or any other Postgres with pgvector only changes the connection string.

**Trade-offs:** free-tier limits, and it is another account to manage. A first query after the database has been idle can be slower.

### 6.2 Why Claude, and why the Haiku model

- **Tool calling is the core of the app.** The assignment is about an agent that decides which tool to call. Claude's tool use is a first-class API feature, with structured tool calls, and I can stream the answer while still handling tool steps.
- **It follows rules well.** My guardrails depend on a model that respects "answer only from the tool results" and "cite exact lines". It is not perfect (see section 8) and I added code checks for that reason, but it follows the instructions more often than not.
- **I already knew the API.** I had built a small GenAI project with Node.js and the Claude API before this, so I could spend my time on retrieval, evals and guardrails and not on learning a new SDK.
- **Haiku by default, Sonnet when needed.** Every eval run makes 11 real calls with several steps each. A small, cheap model lets me run it many times. The model is one environment variable (`LLM_MODEL`), so switching to a stronger model for a demo needs no code change.

**Trade-off:** Haiku is weaker on hard, multi-file questions. I did not compare vendors; I chose one that fit the task and kept the model easy to swap.

### 6.3 Why Render, and why Docker only runs in the cloud

Docker and Render solve different problems. Docker packages the app, and Render hosts it. My problem is that I had configuration issues, and my Windows 10 did not support running Docker, so I **cannot build or run a container locally**.

That decided my approach:

- I picked a host that **builds from the GitHub repository**, so I do not need Docker on my machine. Render does that, redeploys on every push, and has a free tier suitable for a demo.
- I deploy the API on Render's **Docker runtime**, so Render builds my `server/Dockerfile` (node:22-slim, one stage, production dependencies only, non-root user) and runs the result. That build succeeded and the API answers on `/api/health`. Render's build is my only check of the image, so I kept the Dockerfile deliberately simple.
- The frontend is a separate Render **static site**, because it only needs the built Angular files.

**Trade-offs of the free instance:** it has 0.1 CPU and 512 MB RAM and sleeps after 15 minutes without traffic (waking up takes about a minute). The local embedding model needs memory and CPU, so indexing a new repo there can be very slow. For a real deployment I would use a container service (see section 10).

---

## 7. Other key technical decisions

These are the ones that shaped the rest of the app. The smaller choices (chunk size, embeddings, vector database) are in section 5.1.

1. **Check every citation on the server.** *Alternative:* trust the prompt rule. My first strict eval run showed the model inventing line ranges, and a prompt rule alone did not stop it. So the server checks each citation and the UI marks the ones it cannot verify. *Trade-off:* it checks that the lines exist, not that they prove the claim.
2. **"Not found" instead of guessing, enforced in code.** *Alternative:* always give a best-effort answer, or rely only on the prompt. A confident wrong answer is the worst result for a tool people use to learn a codebase. The prompt asks for a clean refusal, and when the model still added a citation (1 of 3 refusals, in two different runs) I made the server remove it. *Trade-off:* a refusal can still be wrong. This guard only stops it from looking more certain than it is.
3. **Hybrid retrieval with RRF.** *Alternative:* vector only. Code questions mix exact identifiers with vague meaning, and a small general embedding model is weak on identifiers. *Trade-off:* more parts, and on my small eval the benefit is not proven.
4. **My own agent loop, no framework.** *Alternative:* LangChain or an agent SDK. The loop is about 100 lines and I wanted to see every step, token and cache number myself. *Trade-off:* I maintain it, and I get no ready-made features.
5. **Prompt caching and no repeated chunks.** See 5.9. *Trade-off:* a modest gain that pays off most on multi-step questions, and its exact size is uncertain.

---

## 8. Issues I faced and how I fixed them

| # | Problem | How I found it | Fix |
|---|---|---|---|
| 1 | **No pgvector locally.** The extension query returned 0 rows. | Ran the query in pgAdmin. | Moved to Neon (section 6.1). |
| 2 | **Pasted commands broke in Git Bash.** Multi-line pastes added invisible characters, so `curl` failed with strange errors. | The error showed odd bytes before the command. | Put the commands in a script file with LF line endings, or typed them by hand. |
| 3 | **Agent tests failed (2 of 4).** Tool results were not reaching the message history. | Test output showed the history missing the results. | Rewrote the `ask` loop so each tool result is appended as a user message. |
| 4 | **`verify.test.ts` failed with "Error: db down".** The first two suggested explanations (a missing try/catch) were wrong. | Pasted the failing output and `verify.ts` back; when the two fixes did not work, the failure was reproduced in isolation. | The real cause: `beforeEach(() => mock.mockReset())` returned the mock, and the test runner called it as a cleanup function. Adding braces fixed it. |
| 5 | **The model invented line ranges** (for example a range past the end of a file), and **refusals still cited files**. | The strict eval: 7/8 answerable, 1/3 refused. | Tighter prompt rules (cite only lines shown, no citations in "Not found"), a server-side verifier, red strike-through for unverified citations in the UI, and a stricter pass check. Run 2: 8/8 and 3/3. |
| 6 | **Path traversal risk.** GitHub owner or repo names made only of dots could point outside the intended folder. | Reviewing the ingestion code. | Added a check in the GitHub ingestion. |
| 7 | **Citations showed as raw text** like `[README.md:25-54, README.md:49-74]`. | Screenshot of the UI mid-stream. | A more tolerant parser that accepts several citations in one bracket. |
| 8 | **Token numbers looked better than they were** after adding caching. | `input_tokens` dropped suspiciously. | The API excludes cached tokens from `input_tokens`. The eval now adds cache reads and writes back (section 5.9). |
| 9 | **TypeScript rejected my cache helper.** The SDK's message type also allows a `"system"` role. | Compiler error at type-check. | Narrowed the type by checking the last message's role before adding the cache marker. |
| 10 | **A warm cache inflated one eval row.** | The first question showed 100% cached. | I had run the same question minutes earlier. I note it in the results. |
| 11 | **Indexing is slow.** 75 files took 36.5 s with the local embedding model on CPU. | Index timing in the UI. | Accepted as a trade-off for no extra API key; listed as a limitation. |
| 12 | **Docker did not run on my machine.** | I had configuration issues, and my Windows 10 did not support the Docker run. | Section 6.3. |
| 13 | **A refusal still carried a citation** in one eval run (10/11). | The eval's stricter refusal check. | Moved the rule into code: `refusal.ts` removes citations from any "Not found" answer, with unit tests. Run 4 passed 3/3 without needing it. In run 5 the model cited again on one refusal and the server removed the citation, so the guard has worked live. |
| 14 | **The repo had no database schema.** The table had been created by hand in Neon, so a fresh clone could not run. | Searched the code for `CREATE TABLE` and found none. | Read the real columns from Neon and wrote `server/schema.sql`. |
| 15 | **Token cost varied about 30% between runs** with the same token code. | Run 3, 4 and 5 averages. | Stopped claiming an exact saving; report all three runs and note that a fair measurement needs several runs per question. |
| 16 | **The client had the API address hard-coded to `localhost`**, which would break the deployed site for everyone else. | Preparing the deployment. | The address is now chosen at load time: `localhost` uses the local API, any other host uses the deployed API. |
| 17 | **The first Render deploy failed within seconds**, before the build started. | The deploy log ended right after the checkout line. | It was the Root Directory: my Dockerfile is in server/, so I set the service's Root Directory to server. |
| 18 | **The API address showed 404 in the browser.** | Opened the base URL of the API. | Not a fault: the API only has routes under `/api`. I checked `/api/health` and `/api/repos` instead. |
| 19 | **The static site build failed with "Publish directory does not exist".** | The Render build log. | Angular writes the site to `dist/client/browser`. I listed the folder locally to confirm, then set the publish directory to that path. |
| 20 | **The live site still called `localhost:3000`.** | The browser console showed `ERR_CONNECTION_REFUSED` to localhost. | The address change was not committed yet. I edited `api.service.ts`, rebuilt, and pushed; Render redeployed. |
| 21 | **The browser blocked the API with a CORS error.** | The console named the allowed origin: my placeholder value. | I had left a placeholder in `CLIENT_ORIGIN`. I set it to the static site's exact address and the API redeployed. |
| 22 | **Pressing Stop left an empty grey bubble.** | Used the live site. | The stop was treated as a silent cancel. The message is now marked as stopped and shows "Interaction stopped by user." |
| 23 | **Indexing a repo on the live site failed with "GitHub rate limit reached".** | The red message under the Index button. | Not a code bug: anonymous GitHub API calls from Render's shared IP are limited to 60 per hour. The server already supports `GITHUB_TOKEN`, so I created a read-only token and set it in Render's environment (never in the repo). |

---

## 9. Engineering standards: followed and skipped

**Followed**

- Small modules with one job each; the LLM client, database and embeddings are replaced with mocks in tests.
- TypeScript strict mode, checked in CI (`npm run typecheck`).
- 42 tests: chunking, RRF, BM25, file filtering, citation parsing, refusal handling, ingestion safety, citation verification and the agent loop.
- Configuration through environment variables; `.env` git-ignored; secrets set in the Render dashboard and never in the repo.
- Input validation with zod; request size and rate limits; CORS limited to the frontend address.
- Structured logging.
- GitHub Actions on every push: install, test, type-check, client build, non-blocking `npm audit`.
- A Dockerfile with a non-root user, built and run by Render.
- A committed `schema.sql`, so the database can be recreated.
- Small commits with conventional messages, one concern each.

**Skipped or partial** (I would rather say this than hide it)

- **Not test-driven.** I wrote tests after the core modules to move faster.
- Only the API is containerised. The frontend is built and served by Render's static hosting, and there is no `docker-compose` file for running everything together locally.
- No authentication; indexed repos are shared by everyone who uses the server.
- The deployed API address is a constant in the client source, not an environment setting.
- No tracing (OpenTelemetry), metrics endpoint, ESLint/Prettier setup, browser end-to-end tests or load tests.

---

## 10. Deployment, productionizing and scaling

### Current deployment (Render and Neon)

| Part | Where | How |
|---|---|---|
| Database | Neon (Postgres + pgvector) | `server/schema.sql` run once; shared by my laptop and the deployment |
| API | Render web service, free instance | Docker runtime, Root Directory `server`, health check `/api/health` |
| Frontend | Render static site | Root Directory `client`, build `npm install && npm run build`, publish directory `dist/client/browser`, `NODE_VERSION=22` |

- **API environment variables** (set in the Render dashboard, not in the repo): `ANTHROPIC_API_KEY`, `DATABASE_URL`, `LLM_MODEL`, `MAX_AGENT_STEPS`, `CLIENT_ORIGIN` (the static site's address), `GITHUB_TOKEN`.
- **Redeploys:** both services rebuild automatically on every push to `main`.
- **Demo data:** I indexed the demo repository from my laptop into the shared Neon database, so the deployed API can answer right away. Indexing on the free instance (0.1 CPU, 512 MB) is too slow to rely on.
- **Sleep behaviour:** the free API sleeps after 15 minutes without traffic, so the first request after a pause takes about a minute.

### Target architecture on AWS

| Concern | Approach |
|---|---|
| API | Container on ECS Fargate (or App Runner) behind a load balancer, autoscaling on CPU and request rate |
| Frontend | Angular build in S3 behind CloudFront |
| Database | Aurora / RDS PostgreSQL with pgvector, Multi-AZ, automated backups |
| Ingestion | Move off the request path: the API puts a job on SQS, workers index it, and status is stored in the database |
| Keyword search | Replace in-memory BM25 with OpenSearch (BM25 and vectors in one engine) so the index is shared across instances |
| Embeddings | A dedicated, batched embedding service instead of running the model inside the API |
| LLM | Anthropic API, or Claude on Amazon Bedrock for private networking and one bill |
| Secrets | Secrets Manager, no secrets in images |
| Security | WAF, TLS, authentication (Cognito/OIDC), per-user quotas |
| Observability | OpenTelemetry to CloudWatch/X-Ray; alarms on latency, error rate and token spend |
| CI/CD and IaC | GitHub Actions to ECR to ECS with rollback; Terraform or CDK |
| Cost | Prompt caching (already done), response caching for repeated questions, a cheaper model for simple questions |

Equivalents elsewhere: Cloud Run + Cloud SQL on GCP, Container Apps + Azure Database for PostgreSQL on Azure.

### What I would do first

The in-memory BM25 index and in-request ingestion are the two things that stop the API from scaling past one instance, so I would move those first. After that, authentication with per-user repos, then tracing so cost and latency per question are visible.

---

## 11. How I used AI tools

I used Claude Code in VS Code for most of this project. In short: Claude wrote the first drafts of most modules and tests, and I decided what to build, ran everything, and fixed what broke. My commits carry my name only, so this section is where the AI's part is written down.

**What I did myself**

- Picked the problem and the stack: Angular and Express, Postgres with pgvector, minisearch for BM25, and my own agent loop with no framework.
- Set up Neon, the API key, the GitHub repo, the GitHub token and the Render services.
- Noticed the repeated token cost, asked why it happens, and decided to fix it. I also decided what to improve in the UI.
- Read every change before running it, and ran and debugged each step on my own machine.

**What Claude did**

- First drafts of most modules and tests, ideas when I was stuck, and help tidying the commit history.

**Where it was wrong** (more in section 8)

- It gave me two explanations for the failing `verify.test.ts` and neither was the cause. The real one showed up when I reproduced it in isolation: a `beforeEach` that returned the mock.
- The model invented line ranges in answers, so I stopped trusting the prompt and added a server-side check.
- After I added caching, the token numbers looked too good because the API leaves cached tokens out of `input_tokens`. I changed the stats to add them back.
- I left a placeholder in `CLIENT_ORIGIN` and it caused the CORS error on the live site. I had to come back and fix it.

**How I keep it under control**

- Every module has tests with the LLM, database and embeddings mocked. Tests, type-check and CI run the same way whoever wrote the code.
- If a prompt cannot guarantee something (citations, "Not found"), I enforce it in code and add a test. The eval then shows whether the change helped.
- I added [`CLAUDE.md`](CLAUDE.md) partway through, once I noticed I was repeating myself. Claude Code reads it every session. It says: small changes, run the checks before saying done, no code comments, never commit or push unless I ask, and don't invent my reasoning in this README.

**My do's and don'ts**

- Do keep steps small, paste the real error, and measure before claiming an improvement.
- Don't commit `.env`, don't accept code I can't explain, and don't trust a prompt rule where I can write a code check.

---

## 12. Known limitations

- Public GitHub repos and ZIP uploads only; no private-repo login.
- Large repos are truncated (limits: 25 MB ZIP, 1,500 files, 3,000 chunks); the UI says when this happened.
- Line-window chunks can split a long function in two.
- No call-graph analysis, so "who calls this?" relies on text and semantic search.
- BM25 lives in memory: one instance only, rebuilt after a restart.
- The local embedding model is small; quality on unusual code may vary, and indexing on CPU is slow.
- **On the free Render instance** (0.1 CPU, 512 MB RAM) indexing a new repo may be very slow or fail, and the API sleeps after 15 minutes idle, so the first request takes about a minute. The demo uses a repo indexed beforehand.
- Without a `GITHUB_TOKEN`, indexing public repos on the deployed site can hit GitHub's anonymous rate limit (60 requests per hour per IP).
- No authentication or per-user isolation.
- Citation verification checks that lines exist, not that they prove the claim.
- Refusals depend on the model: in two of my five runs it added a citation to 1 of 3 refusals. The server now removes citations from any "Not found" answer, and it did so in run 5. A refusal can also be wrong (the answer exists but was not found).
- Prompt-injection defences reduce risk and do not remove it.
- The eval set is small, partly written after seeing outputs, and tuned against; treat the numbers as a smoke test.
- Token cost varies about 30% between runs, so the exact saving from caching is uncertain.
- The Docker image was never run on my own machine; Render's build is the only check.

---

## 13. What I would do differently with more time

My top three:

1. **A better eval.** Everything I say about quality rests on 11 questions on one repo, and I tuned my prompt against them, so the numbers look better than they are. I would write new questions on a few other repos before looking at any output, run each several times, and report the average and spread. Every other improvement needs this to prove it helped.
2. **Make the API stateless.** BM25 lives in memory and indexing runs inside the web request, so it only works as one instance. I would move keyword search into the database and run indexing as a background job. This breaks first when more than a few people use it.
3. **Check that a citation supports the claim.** Today I only check that the cited lines exist. A wrong answer with a real citation is the failure that worries me most, because it looks trustworthy.

Later: a reranker, structure-aware chunking, an MCP server, authentication and tracing.

---

## Screenshots

Attached in the Word document.

**Video:** attached in mail

---

## Appendix

- **A. System prompt:** see `SYSTEM_PROMPT` in `server/src/agent.ts`.
- **B. Eval questions and saved results:** `server/evals/questions.json`, `server/evals/results.json` (latest run, run 5), `server/evals/results-baseline.json` (run 2) and `server/evals/results-run3-10of11.json` (run 3) and `server/evals/results-run4.json` (run 4).
- **C. Database schema:** `server/schema.sql`.
