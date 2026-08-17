"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Wordmark from "@/components/Wordmark";

type Stage =
  | "welcome"
  | "asking"
  | "recording"
  | "processing"
  | "confirm"
  | "evidence_loading"
  | "evidence"
  | "done"
  | "error";

interface EvidenceClaim {
  id: string;
  claim: string;
  hint: string;
}

// A document already uploaded for a claim (API shape from the evidence routes).
interface UploadRec {
  artifact_id: string;
  claim_id: string;
  file_name: string;
  provenance_complete: boolean;
}

const EMPTY_PROV = { what: "", author: "", date: "", origin: "" };
const MAX_UPLOAD_MB = 4;

const PROV_FIELDS: { key: keyof typeof EMPTY_PROV; label: string; placeholder: string }[] = [
  { key: "what", label: "What is this document?", placeholder: "e.g. FY24 President's Club award letter" },
  { key: "author", label: "Who created it?", placeholder: "e.g. AT&T sales operations" },
  { key: "date", label: "When?", placeholder: "e.g. January 2025" },
  { key: "origin", label: "Where did it come from, and who could confirm it's real?", placeholder: "e.g. company HR portal; my former VP Jane Doe could confirm" },
];

const ACCENT = "#6B9FD4";

// Mirrors PHASES in src/lib/interviewer.ts (not imported: that module pulls
// the server-side Anthropic SDK into the client bundle).
const PHASE_ORDER = [
  "arc",
  "evidence",
  "operating_profile",
  "constraints",
  "adjudication",
  "witnesses",
];

function pickMimeType(): string {
  const candidates = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return "";
}

export default function InterviewClient() {
  const [stage, setStage] = useState<Stage>("welcome");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [phase, setPhase] = useState("");
  const [transcript, setTranscript] = useState("");
  const [pendingNext, setPendingNext] = useState<{ question: string; phase: string; done: boolean } | null>(null);
  const [typed, setTyped] = useState("");
  const [showTyping, setShowTyping] = useState(false);
  const [resumeText, setResumeText] = useState<string | null>(null);
  const [resumeStatus, setResumeStatus] = useState<string | null>(null);
  const lastPayloadRef = useRef<Record<string, string> | null>(null);
  const lastBlobRef = useRef<{ blob: Blob; mimeType: string } | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [claims, setClaims] = useState<EvidenceClaim[]>([]);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [savedLinks, setSavedLinks] = useState(0);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [uploads, setUploads] = useState<UploadRec[]>([]);
  const [uploadForm, setUploadForm] = useState<{ claimId: string; file: File } | null>(null);
  const [prov, setProv] = useState(EMPTY_PROV);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const [dossierUrl, setDossierUrl] = useState<string | null>(null);
  const [notifyEmail, setNotifyEmail] = useState("");
  const [emailSaved, setEmailSaved] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Resume an interrupted session.
  useEffect(() => {
    const saved = localStorage.getItem("trueseat_session");
    if (!saved) return;
    fetch(`/api/interview/${saved}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => {
        if (s && !s.done && s.question) {
          setSessionId(saved);
          setQuestion(s.question);
          setPhase(s.phase);
          setStage("asking");
        } else if (s && s.done) {
          // Finished interviewing but may have left before the evidence step.
          setSessionId(saved);
          enterEvidence(saved);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const start = useCallback(async () => {
    setStage("processing");
    try {
      const res = await fetch("/api/interview/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(resumeText ? { resumeText } : {}),
      });
      const s = await res.json();
      localStorage.setItem("trueseat_session", s.sessionId);
      setSessionId(s.sessionId);
      setQuestion(s.question);
      setPhase(s.phase);
      setStage("asking");
    } catch {
      setErrorMsg("Couldn't start the interview. Refresh and try again.");
      setStage("error");
    }
  }, [resumeText]);

  const uploadResume = useCallback(async (file: File) => {
    setResumeStatus("parsing");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/resume", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "parse failed");
      setResumeText(data.text);
      setResumeStatus(`✓ ${file.name} read (${Math.round(data.chars / 1000)}k chars)`);
    } catch (err) {
      setResumeStatus(
        err instanceof Error && err.message !== "parse failed"
          ? `Couldn't read that: ${err.message}`
          : "Couldn't read that file — PDF, docx, or txt work best."
      );
    }
  }, []);

  const beginRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      // 32kbps opus is transparent for speech and keeps even a 10-minute answer
      // far under Vercel's ~4.5MB request cap (default browser bitrates hit the
      // cap at ~3.5 minutes — a long first answer used to 413).
      const rec = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 32000,
      });
      chunksRef.current = [];
      rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      rec.start();
      recorderRef.current = rec;
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
      setStage("recording");
    } catch {
      setErrorMsg("Microphone access was blocked. You can type your answer instead.");
      setShowTyping(true);
      setStage("asking");
    }
  }, []);

  const submitAnswer = useCallback(
    async (payload: Record<string, string>) => {
      // Keep the payload so a network/service hiccup never costs the candidate
      // a recorded answer — the error screen can resubmit it verbatim.
      lastPayloadRef.current = payload;
      setStage("processing");
      try {
        const res = await fetch(`/api/interview/${sessionId}/answer`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        lastPayloadRef.current = null;
        setTranscript(data.transcript);
        setPendingNext({ question: data.question, phase: data.phase, done: data.done });
        setStage("confirm");
      } catch {
        setErrorMsg(
          "That answer didn't go through — your recording is still here, nothing was lost."
        );
        setStage("error");
      }
    },
    [sessionId]
  );

  // X22: recordings go straight to storage via a signed URL, so answer length
  // is unlimited — Vercel's request-body cap never sees the audio. The blob is
  // kept for retry until the upload succeeds; after that, the storage path is
  // what gets resent (the object is already safe server-side).
  const submitAudio = useCallback(
    async (blob: Blob, mimeType: string) => {
      lastBlobRef.current = { blob, mimeType };
      lastPayloadRef.current = null;
      setStage("processing");
      try {
        const urlRes = await fetch(`/api/interview/${sessionId}/answer-upload`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mimeType }),
        });
        if (urlRes.status === 503) {
          // Local dev without storage: fall back to inline base64 for short
          // clips (Vercel's cap doesn't apply to localhost anyway).
          const base64 = await new Promise<string>((resolve) => {
            const fr = new FileReader();
            fr.onloadend = () => resolve(String(fr.result).split(",")[1]);
            fr.readAsDataURL(blob);
          });
          lastBlobRef.current = null;
          await submitAnswer({ audioBase64: base64, mimeType });
          return;
        }
        if (!urlRes.ok) throw new Error(await urlRes.text());
        const { path, uploadUrl } = await urlRes.json();
        const put = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "content-type": mimeType, "x-upsert": "true" },
          body: blob,
        });
        if (!put.ok) throw new Error(`upload ${put.status}`);
        lastBlobRef.current = null;
        await submitAnswer({ audioPath: path, mimeType });
      } catch {
        setErrorMsg(
          "That answer didn't go through — your recording is still here, nothing was lost."
        );
        setStage("error");
      }
    },
    [sessionId, submitAnswer]
  );

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (timerRef.current) clearInterval(timerRef.current);
    rec.onstop = async () => {
      rec.stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: rec.mimeType });
      await submitAudio(blob, rec.mimeType.split(";")[0] || "audio/webm");
    };
    rec.stop();
  }, [submitAudio]);

  // The evidence step. The interview is done; a claims pass lists what a link
  // could back, the candidate pastes links (or skips), then we truly finish.
  const enterEvidence = useCallback(
    async (id: string) => {
      setStage("evidence_loading");
      try {
        const res = await fetch(`/api/interview/${id}/evidence`);
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        if (data.submitted || !data.claims?.length) {
          setStage("done");
          return;
        }
        setClaims(data.claims);
        setUploads(Array.isArray(data.uploads) ? data.uploads : []);
        setStage("evidence");
      } catch {
        // Evidence is additive; never strand a finished interview behind it.
        setStage("done");
      }
    },
    []
  );

  const submitEvidence = useCallback(async () => {
    if (!sessionId) return;
    setEvidenceBusy(true);
    const items = Object.entries(links)
      .map(([claim_id, raw]) => ({ claim_id, url: raw.trim() }))
      .filter((i) => i.url)
      .map((i) => ({
        ...i,
        url: /^https?:\/\//i.test(i.url) ? i.url : `https://${i.url}`,
      }));
    try {
      const res = await fetch(`/api/interview/${sessionId}/evidence`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setSavedLinks(data.saved ?? items.length);
    } catch {
      // Same principle: a hiccup here must not trap the candidate.
    }
    setEvidenceBusy(false);
    setStage("done");
  }, [sessionId, links]);

  // Document uploads (X18 Phase 2). Picking a file opens the provenance
  // form; the upload posts immediately on "Attach", independent of the final
  // links submission, so nothing is lost if the candidate bails later.
  const pickFile = useCallback((claimId: string, file: File | null) => {
    if (!file) return;
    setUploadErr("");
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setUploadErr(`That file is over ${MAX_UPLOAD_MB}MB — export a smaller version and retry.`);
      return;
    }
    setProv(EMPTY_PROV);
    setUploadForm({ claimId, file });
  }, []);

  const submitUpload = useCallback(async () => {
    if (!sessionId || !uploadForm) return;
    setUploadBusy(true);
    setUploadErr("");
    try {
      const fd = new FormData();
      fd.append("file", uploadForm.file);
      fd.append("claim_id", uploadForm.claimId);
      for (const f of PROV_FIELDS) fd.append(f.key, prov[f.key]);
      const res = await fetch(`/api/interview/${sessionId}/evidence/upload`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "upload failed");
      setUploads((u) => [...u, data.upload]);
      setUploadForm(null);
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : "Upload failed — try again.");
    }
    setUploadBusy(false);
  }, [sessionId, uploadForm, prov]);

  const deleteUpload = useCallback(
    async (artifactId: string) => {
      if (!sessionId) return;
      setUploads((u) => u.filter((x) => x.artifact_id !== artifactId));
      await fetch(`/api/interview/${sessionId}/evidence/upload`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ artifact_id: artifactId }),
      }).catch(() => {});
    },
    [sessionId]
  );

  // X25: the end screen kicks off server-side dossier generation and polls
  // until the draft link exists, then hands it over in-page. A poll that
  // finds neither a dossier nor a live generation marker re-POSTs, so a
  // timed-out or crashed attempt self-heals while the candidate waits.
  useEffect(() => {
    if (stage !== "done" || !sessionId || dossierUrl) return;
    let stopped = false;
    const kick = () =>
      fetch(`/api/interview/${sessionId}/dossier`, { method: "POST" }).catch(
        () => {}
      );
    kick();
    const iv = setInterval(async () => {
      try {
        const res = await fetch(`/api/interview/${sessionId}/dossier`);
        if (!res.ok || stopped) return;
        const data = await res.json();
        if (data.ready && data.url) {
          setDossierUrl(data.url);
          // Link delivered; a future visit starts fresh instead of resuming.
          localStorage.removeItem("trueseat_session");
          clearInterval(iv);
        } else if (!data.generating) {
          kick();
        }
      } catch {
        // transient; next tick retries
      }
    }, 6000);
    const cutoff = setTimeout(() => clearInterval(iv), 20 * 60 * 1000);
    return () => {
      stopped = true;
      clearInterval(iv);
      clearTimeout(cutoff);
    };
  }, [stage, sessionId, dossierUrl]);

  const submitNotifyEmail = useCallback(async () => {
    if (!sessionId || !notifyEmail.trim()) return;
    setEmailBusy(true);
    try {
      const res = await fetch(`/api/interview/${sessionId}/contact`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: notifyEmail.trim() }),
      });
      if (res.ok) setEmailSaved(true);
    } catch {
      // leave the form up; the candidate can retry
    }
    setEmailBusy(false);
  }, [sessionId, notifyEmail]);

  const advance = useCallback(() => {
    if (!pendingNext) return;
    if (pendingNext.done) {
      if (sessionId) {
        enterEvidence(sessionId);
      } else {
        localStorage.removeItem("trueseat_session");
        setStage("done");
      }
      return;
    }
    setQuestion(pendingNext.question);
    setPhase(pendingNext.phase);
    setPendingNext(null);
    setTranscript("");
    setTyped("");
    setStage("asking");
  }, [pendingNext, sessionId, enterEvidence]);

  const mm = String(Math.floor(elapsed / 60)).padStart(1, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <main className="min-h-screen bg-[#0e1116] text-[#e8eaf0] flex flex-col">
      <div className="mx-auto w-full max-w-2xl px-6 py-16 flex-1 flex flex-col">
        <div className="mb-10">
          <a
            href="/"
            className="inline-block mb-6 text-[#e8eaf0] no-underline"
            aria-label="TrueSeat home"
          >
            <Wordmark className="text-base" />
          </a>
          <p className="text-xs tracking-[0.25em] uppercase text-[#7fa6d9]">
            TrueSeat Interview
            {stage === "evidence" || stage === "evidence_loading"
              ? " · evidence"
              : phase && phase !== "done" && stage !== "welcome"
              ? ` · ${phase.replace("_", " ")}`
              : ""}
          </p>
          {phase && phase !== "done" && stage !== "welcome" && stage !== "done" && (
            <div className="flex gap-1.5 mt-3" aria-label={`Phase ${PHASE_ORDER.indexOf(phase) + 1} of ${PHASE_ORDER.length}`}>
              {PHASE_ORDER.map((p, i) => (
                <span
                  key={p}
                  title={p.replace("_", " ")}
                  className={`h-1 flex-1 max-w-12 rounded-full transition-colors ${
                    i < PHASE_ORDER.indexOf(phase)
                      ? "bg-[#6B9FD4]"
                      : i === PHASE_ORDER.indexOf(phase)
                      ? "bg-[#8ab4e0] animate-pulse"
                      : "bg-[#2a3242]"
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {stage === "welcome" && (
          <div className="my-auto">
            <h1 className="text-3xl font-semibold mb-4">This is a conversation, not a form.</h1>
            <p className="text-[#a8b0c0] leading-relaxed mb-3">
              Tap the button, talk as long as you want, tap when you&apos;re done. We&apos;ll
              show you exactly what we heard after every answer, and you can re-record
              anything. Takes about 45 minutes; you can leave and come back anytime.
            </p>
            <p className="text-[#a8b0c0] leading-relaxed mb-8">
              Everything you say belongs to you. Nothing ships without your review.
            </p>
            <div className="mb-8 rounded-md border border-[#2a3242] bg-[#12161f] p-5">
              <p className="text-sm text-[#c8cedb] mb-1">
                Have a resume? Start with it — free.
              </p>
              <p className="text-xs text-[#6d7585] mb-3 leading-relaxed">
                Your resume gets you what it&apos;s always gotten you. The interview is
                where you become more than it — but it gives us a head start on sharper
                questions.
              </p>
              <label
                className="inline-block cursor-pointer rounded-md border border-[#3a4456] px-4 py-2 text-sm text-[#c8cedb] hover:border-[#6B9FD4] transition-colors"
              >
                {resumeText ? "Replace resume" : "Upload resume (PDF, docx, txt)"}
                <input
                  type="file"
                  accept=".pdf,.docx,.txt,application/pdf,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadResume(f);
                  }}
                />
              </label>
              {resumeStatus && (
                <p className="text-xs mt-2 text-[#a8b0c0]">
                  {resumeStatus === "parsing" ? "Reading your resume…" : resumeStatus}
                </p>
              )}
            </div>
            <button
              onClick={start}
              disabled={resumeStatus === "parsing"}
              className="rounded-md px-6 py-3 font-medium text-[#0e1116] transition-colors disabled:opacity-50"
              style={{ backgroundColor: ACCENT }}
            >
              {resumeText ? "Start the interview with my resume" : "Start the interview"}
            </button>
          </div>
        )}

        {(stage === "asking" || stage === "recording") && (
          <div className="my-auto">
            <p className="text-2xl leading-relaxed mb-10">{question}</p>

            {stage === "asking" && !showTyping && (
              <div className="flex flex-col items-start gap-4">
                <button
                  onClick={beginRecording}
                  className="rounded-full w-20 h-20 flex items-center justify-center text-3xl transition-colors"
                  style={{ backgroundColor: ACCENT }}
                  aria-label="Start recording"
                >
                  🎙
                </button>
                <button
                  onClick={() => setShowTyping(true)}
                  className="text-sm text-[#6d7585] underline underline-offset-4"
                >
                  Type instead
                </button>
              </div>
            )}

            {stage === "asking" && showTyping && (
              <div className="flex flex-col gap-4">
                <textarea
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  rows={6}
                  className="w-full rounded-md bg-[#161b24] border border-[#2a3242] p-4 text-[#e8eaf0] focus:outline-none focus:border-[#6B9FD4]"
                  placeholder="Type your answer..."
                />
                <div className="flex gap-4 items-center">
                  <button
                    onClick={() => typed.trim() && submitAnswer({ text: typed.trim() })}
                    className="rounded-md px-5 py-2.5 font-medium text-[#0e1116]"
                    style={{ backgroundColor: ACCENT }}
                  >
                    Send answer
                  </button>
                  <button
                    onClick={() => setShowTyping(false)}
                    className="text-sm text-[#6d7585] underline underline-offset-4"
                  >
                    Talk instead
                  </button>
                </div>
              </div>
            )}

            {stage === "asking" && (
              <button
                onClick={() => {
                  if (!confirm("Start a brand-new interview? This one will be left where it is - your saved answers stay on file.")) return;
                  localStorage.removeItem("trueseat_session");
                  setSessionId(null);
                  setQuestion("");
                  setPhase("");
                  setShowTyping(false);
                  setTyped("");
                  setResumeText(null);
                  setResumeStatus(null);
                  setStage("welcome");
                }}
                className="mt-12 text-xs text-[#6d7585] underline underline-offset-4"
              >
                Start over with a new interview
              </button>
            )}

            {stage === "recording" && (
              <div className="flex flex-col items-start gap-4">
                <button
                  onClick={stopRecording}
                  className="rounded-full w-20 h-20 flex items-center justify-center text-2xl bg-[#E8896A] animate-pulse"
                  aria-label="Stop recording"
                >
                  ⏹
                </button>
                <p className="text-sm text-[#a8b0c0]">
                  Recording {mm}:{ss} — tap to finish. Take your time.
                </p>
              </div>
            )}
          </div>
        )}

        {stage === "processing" && (
          <div className="my-auto">
            <p className="text-lg text-[#a8b0c0] animate-pulse">Listening back…</p>
          </div>
        )}

        {stage === "confirm" && (
          <div className="my-auto">
            <p className="text-sm text-[#7fa6d9] mb-3">Here&apos;s what we heard:</p>
            <p className="text-lg leading-relaxed mb-8 border-l-2 pl-4 border-[#2a3242] text-[#c8cedb]">
              {transcript}
            </p>
            <div className="flex gap-4">
              <button
                onClick={advance}
                className="rounded-md px-5 py-2.5 font-medium text-[#0e1116]"
                style={{ backgroundColor: ACCENT }}
              >
                {pendingNext?.done ? "Finish" : "That's right, next question"}
              </button>
              <button
                onClick={() => {
                  setShowTyping(false);
                  setStage("asking");
                }}
                className="text-sm text-[#6d7585] underline underline-offset-4"
              >
                Answer again
              </button>
            </div>
          </div>
        )}

        {stage === "evidence_loading" && (
          <div className="my-auto">
            <p className="text-lg text-[#a8b0c0] animate-pulse">
              Going back through what you told us…
            </p>
          </div>
        )}

        {stage === "evidence" && (
          <div className="my-auto py-8">
            <h1 className="text-3xl font-semibold mb-3">Now back it up.</h1>
            <p className="text-[#a8b0c0] leading-relaxed mb-2">
              These are the claims from your interview that something public could
              prove: a live product, a press mention, a company page, a repo, a
              filing. Paste a link next to anything you can point at.
            </p>
            <p className="text-xs text-[#6d7585] leading-relaxed mb-8">
              Nothing public? Attach a document instead — an award letter, a
              comp statement, a certificate. Tell us where it came from and
              who could confirm it&apos;s real, and the claim moves up to
              provenance-verified. No link, no document? Leave it blank — the
              claim stays in your dossier, marked self-reported.
            </p>
            {uploadErr && (
              <p className="text-sm text-[#E8896A] mb-4">{uploadErr}</p>
            )}
            <div className="flex flex-col gap-6 mb-8">
              {claims.map((c) => {
                const claimUploads = uploads.filter((u) => u.claim_id === c.id);
                const formOpen = uploadForm?.claimId === c.id;
                return (
                  <div key={c.id} className="rounded-md border border-[#2a3242] bg-[#12161f] p-4">
                    <p className="text-[#e8eaf0] leading-relaxed mb-1">{c.claim}</p>
                    {c.hint && <p className="text-xs text-[#6d7585] mb-3">{c.hint}</p>}
                    <input
                      type="url"
                      inputMode="url"
                      value={links[c.id] ?? ""}
                      onChange={(e) => setLinks((l) => ({ ...l, [c.id]: e.target.value }))}
                      placeholder="https://…"
                      className="w-full rounded-md bg-[#161b24] border border-[#2a3242] px-3 py-2 text-sm text-[#e8eaf0] focus:outline-none focus:border-[#6B9FD4]"
                    />
                    {claimUploads.map((u) => (
                      <div
                        key={u.artifact_id}
                        className="mt-2 flex items-center gap-2 text-sm text-[#c8cedb]"
                      >
                        <span aria-hidden>📄</span>
                        <span className="truncate">{u.file_name}</span>
                        <span className="text-[11px] text-[#6d7585]">
                          {u.provenance_complete
                            ? "provenance on record"
                            : "provenance incomplete"}
                        </span>
                        <button
                          onClick={() => deleteUpload(u.artifact_id)}
                          className="ml-auto text-[#6d7585] hover:text-[#E8896A]"
                          aria-label={`Remove ${u.file_name}`}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {!formOpen && (
                      <label className="mt-3 inline-block text-xs text-[#8ab4e0] cursor-pointer underline underline-offset-4">
                        or attach a document
                        <input
                          type="file"
                          accept=".pdf,.doc,.docx,.txt,.md,.csv,.png,.jpg,.jpeg,.webp"
                          className="hidden"
                          onChange={(e) => {
                            pickFile(c.id, e.target.files?.[0] ?? null);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    )}
                    {formOpen && uploadForm && (
                      <div className="mt-4 rounded-md border border-[#2a4a6b] bg-[#111722] p-4">
                        <p className="text-sm text-[#c8cedb] mb-1 truncate">
                          {uploadForm.file.name}
                        </p>
                        <p className="text-xs text-[#6d7585] leading-relaxed mb-4">
                          Answer all four and this document carries checkable
                          provenance — that&apos;s what moves the claim to
                          provenance-verified instead of just attached.
                        </p>
                        <div className="flex flex-col gap-3 mb-4">
                          {PROV_FIELDS.map((f) => (
                            <div key={f.key}>
                              <label className="block text-xs text-[#a8b0c0] mb-1">
                                {f.label}
                              </label>
                              <input
                                type="text"
                                value={prov[f.key]}
                                onChange={(e) =>
                                  setProv((p) => ({ ...p, [f.key]: e.target.value }))
                                }
                                placeholder={f.placeholder}
                                className="w-full rounded-md bg-[#161b24] border border-[#2a3242] px-3 py-2 text-sm text-[#e8eaf0] focus:outline-none focus:border-[#6B9FD4]"
                              />
                            </div>
                          ))}
                        </div>
                        <div className="flex gap-3 items-center">
                          <button
                            onClick={submitUpload}
                            disabled={uploadBusy}
                            className="rounded-md px-4 py-2 text-sm font-medium text-[#0e1116] disabled:opacity-50"
                            style={{ backgroundColor: ACCENT }}
                          >
                            {uploadBusy ? "Uploading…" : "Attach document"}
                          </button>
                          <button
                            onClick={() => setUploadForm(null)}
                            disabled={uploadBusy}
                            className="text-sm text-[#6d7585] underline underline-offset-4"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex gap-4 items-center">
              <button
                onClick={submitEvidence}
                disabled={evidenceBusy}
                className="rounded-md px-6 py-3 font-medium text-[#0e1116] transition-colors disabled:opacity-50"
                style={{ backgroundColor: ACCENT }}
              >
                {evidenceBusy
                  ? "Saving…"
                  : Object.values(links).some((v) => v.trim())
                  ? "Attach links and finish"
                  : uploads.length > 0
                  ? "Finish"
                  : "Finish without evidence"}
              </button>
            </div>
          </div>
        )}

        {stage === "done" && (
          <div className="my-auto">
            <h1 className="text-3xl font-semibold mb-4">That&apos;s everything.</h1>
            {(savedLinks > 0 || uploads.length > 0) && (
              <p className="text-[#c8cedb] leading-relaxed mb-3">
                {[
                  savedLinks > 0 &&
                    `${savedLinks} ${savedLinks === 1 ? "link" : "links"}`,
                  uploads.length > 0 &&
                    `${uploads.length} ${uploads.length === 1 ? "document" : "documents"}`,
                ]
                  .filter(Boolean)
                  .join(" and ")}{" "}
                attached — that evidence goes into your dossier with the claims
                it backs.
              </p>
            )}
            {dossierUrl ? (
              <>
                <p className="text-[#a8b0c0] leading-relaxed mb-6">
                  Your draft dossier is ready. Read every word — nothing goes
                  anywhere until you&apos;ve approved it.
                </p>
                <a
                  href={dossierUrl}
                  className="inline-block rounded-md px-5 py-2.5 font-medium text-[#0e1116]"
                  style={{ backgroundColor: ACCENT }}
                >
                  Open your draft dossier
                </a>
              </>
            ) : (
              <>
                <p className="text-[#a8b0c0] leading-relaxed">
                  We&apos;re assembling your dossier now — it usually takes a few
                  minutes. Keep this page open and the draft link will appear
                  right here. Nothing goes anywhere until you&apos;ve approved
                  every word.
                </p>
                <div className="flex gap-2 mt-6 max-w-md">
                  <span
                    className="inline-block h-2 w-2 rounded-full animate-pulse mt-2 shrink-0"
                    style={{ backgroundColor: ACCENT }}
                    aria-hidden
                  />
                  <p className="text-sm text-[#6d7585]">Assembling…</p>
                </div>
                {emailSaved ? (
                  <p className="text-sm text-[#a8b0c0] mt-6">
                    Got it — we&apos;ll send the draft link to{" "}
                    <span className="text-[#c8cedb]">{notifyEmail.trim()}</span>.
                    You can close this page.
                  </p>
                ) : (
                  <div className="mt-6 max-w-md">
                    <p className="text-sm text-[#6d7585] mb-2">
                      Don&apos;t want to wait here? Drop your email and we&apos;ll
                      send the link.
                    </p>
                    <div className="flex gap-2">
                      <input
                        type="email"
                        value={notifyEmail}
                        onChange={(e) => setNotifyEmail(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitNotifyEmail();
                        }}
                        placeholder="you@example.com"
                        className="flex-1 rounded-md bg-[#171b23] border border-[#2a3040] px-3 py-2 text-sm text-[#e8ebf2] placeholder-[#4a5164] focus:outline-none focus:border-[#6B9FD4]"
                      />
                      <button
                        onClick={submitNotifyEmail}
                        disabled={emailBusy || !notifyEmail.trim()}
                        className="rounded-md px-4 py-2 text-sm font-medium text-[#0e1116] disabled:opacity-50"
                        style={{ backgroundColor: ACCENT }}
                      >
                        {emailBusy ? "Saving…" : "Email me"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {stage === "error" && (
          <div className="my-auto">
            <p className="text-[#E8896A] mb-6">{errorMsg}</p>
            <div className="flex gap-4 items-center">
              {lastPayloadRef.current || lastBlobRef.current ? (
                <button
                  onClick={() => {
                    if (lastPayloadRef.current) {
                      submitAnswer(lastPayloadRef.current);
                    } else if (lastBlobRef.current) {
                      const { blob, mimeType } = lastBlobRef.current;
                      submitAudio(blob, mimeType);
                    }
                  }}
                  className="rounded-md px-5 py-2.5 font-medium text-[#0e1116]"
                  style={{ backgroundColor: ACCENT }}
                >
                  Resend that answer
                </button>
              ) : (
                <button
                  onClick={() => setStage(sessionId ? "asking" : "welcome")}
                  className="rounded-md px-5 py-2.5 font-medium text-[#0e1116]"
                  style={{ backgroundColor: ACCENT }}
                >
                  Try again
                </button>
              )}
              {(lastPayloadRef.current || lastBlobRef.current) && (
                <button
                  onClick={() => {
                    lastPayloadRef.current = null;
                    lastBlobRef.current = null;
                    setStage(sessionId ? "asking" : "welcome");
                  }}
                  className="text-sm text-[#6d7585] underline underline-offset-4"
                >
                  Discard and re-answer
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
