// TrueSeat ears service: the load-bearing Gemini call in the pipeline.
// Runs on Cloud Run. Accepts candidate audio (voice memo or interview turn),
// returns a verbatim transcript plus a first-pass structured summary that the
// Claude extraction stage consumes downstream.

import { createServer } from "node:http";
import { GoogleGenAI } from "@google/genai";

const PORT = process.env.PORT || 8080;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash";
const MAX_BODY_BYTES = 40 * 1024 * 1024; // Gemini inline limit is ~20MB media; base64 inflates by ~4/3

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const SUMMARY_INSTRUCTIONS = `You are the ingestion pass of TrueSeat, a whole-person hiring dossier system.
Given a candidate audio recording, produce JSON with exactly these keys:
- "transcript": verbatim transcript of the audio.
- "summary": a faithful 150-250 word summary of what the candidate said.
- "claims": array of factual career claims made (quotes or close paraphrase), each as {"claim": string, "quantified": boolean}.
- "stories": array of distinct stories/anecdotes told, each as {"topic": string, "gist": string}.
- "signals": array of short behavioral observations grounded ONLY in what was said (pace, communication style, how they describe conflict/feedback). Never speculate beyond the audio, never use clinical or personality-test labels.
Do not invent, embellish, or round up any figure. If audio is unclear, mark it "[inaudible]".`;

async function ingestAudio({ audioBase64, mimeType }) {
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: audioBase64 } },
          { text: SUMMARY_INSTRUCTIONS },
        ],
      },
    ],
    config: { responseMimeType: "application/json" },
  });
  return JSON.parse(response.text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("payload too large"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");

  if (req.method === "GET" && req.url === "/healthz") {
    res.end(JSON.stringify({ ok: true, model: MODEL }));
    return;
  }

  if (req.method === "POST" && req.url === "/ingest") {
    // Shared-secret check so only the TrueSeat app can call this service.
    if (process.env.EARS_SHARED_SECRET && req.headers["x-ears-secret"] !== process.env.EARS_SHARED_SECRET) {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    try {
      const body = JSON.parse((await readBody(req)).toString("utf8"));
      if (!body.audioBase64 || !body.mimeType) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "audioBase64 and mimeType are required" }));
        return;
      }
      const result = await ingestAudio(body);
      res.end(JSON.stringify({ model: MODEL, ...result }));
    } catch (err) {
      res.statusCode = err.status || 500;
      res.end(JSON.stringify({ error: String(err.message || err) }));
    }
    return;
  }

  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

server.listen(PORT, () => {
  console.log(`trueseat-ears listening on :${PORT} (model: ${MODEL})`);
});
