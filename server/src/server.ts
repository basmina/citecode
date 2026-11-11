import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { ask } from "./agent.js";
import { embed } from "./embeddings.js";
import { ingestFromGithub, ingestFromZip, IngestError } from "./ingest.js";
import { listRepos, repoExists, getFileLines } from "./store.js";
import { logger } from "./logger.js";

const PORT = Number(process.env.PORT ?? 3000);

const app = express();
app.set("trust proxy", 1);
app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? "http://localhost:4200" }));
app.use(express.json({ limit: "20kb" }));

const chatLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many questions. Please wait a minute and try again." },
});
const ingestLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many indexing requests. Please try again later." },
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 1 } });

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/repos", async (_req, res) => {
  try {
    res.json(await listRepos());
  } catch (err) {
    logger.error({ err }, "list repos failed");
    res.status(500).json({ error: "Could not list repositories." });
  }
});

app.post("/api/ingest", ingestLimiter, (req, res) => {
  upload.single("zip")(req, res, async (uploadErr: any) => {
    if (uploadErr) {
      const tooBig = uploadErr.code === "LIMIT_FILE_SIZE";
      return res.status(tooBig ? 413 : 400).json({ error: tooBig ? "ZIP is too large (limit 25 MB)." : "Upload failed." });
    }
    try {
      const result = req.file
        ? await ingestFromZip(req.file.originalname, req.file.buffer)
        : await ingestFromGithub(String(req.body?.url ?? ""));
      res.json(result);
    } catch (err) {
      if (err instanceof IngestError) return res.status(err.status).json({ error: err.message });
      logger.error({ err }, "ingest failed");
      res.status(500).json({ error: "Indexing failed. Please try again." });
    }
  });
});

const chatBody = z.object({
  repoId: z.string().regex(/^[a-z0-9._-]{1,80}$/),
  question: z.string().trim().min(1).max(1000),
});

app.post("/api/chat", chatLimiter, async (req, res) => {
  const parsed = chatBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Send a repoId and a question of up to 1000 characters." });
  }
  const { repoId, question } = parsed.data;
  if (!(await repoExists(repoId))) {
    return res.status(404).json({ error: "That repository is not indexed yet." });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event: string, data: unknown) => {
    if (res.writableEnded || res.destroyed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  try {
    const { stats, citations } = await ask(repoId, question, {
      onToken: (text) => send("token", { text }),
      onStatus: (message) => send("status", { message }),
      onReset: () => send("reset", {}),
      signal: controller.signal,
    });
    send("done", { stats, citations });
  } catch (err) {
    logger.error({ err, repoId }, "chat failed");
    send("error", { message: "Something went wrong while answering. Please try again." });
  }
  res.end();
});

const fileQuery = z.object({
  repoId: z.string().regex(/^[a-z0-9._-]{1,80}$/),
  path: z.string().min(1).max(300),
  start: z.coerce.number().int().min(1).default(1),
  end: z.coerce.number().int().min(1).default(60),
});

app.get("/api/file", async (req, res) => {
  const q = fileQuery.safeParse(req.query);
  if (!q.success) return res.status(400).json({ error: "Invalid request." });
  try {
    const { repoId, path, start, end } = q.data;
    const file = await getFileLines(repoId, path, start, end, 120);
    if (!file) return res.status(404).json({ error: "File not found in this repository." });
    res.json(file);
  } catch (err) {
    logger.error({ err }, "file lookup failed");
    res.status(500).json({ error: "Could not load the file." });
  }
});

app.listen(PORT, () => {
  logger.info({ port: PORT }, "CiteCode API listening");
  embed(["warm up"]).catch(() => {});
});