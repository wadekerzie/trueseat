"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Stage =
  | "welcome"
  | "asking"
  | "recording"
  | "processing"
  | "confirm"
  | "done"
  | "error";

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
  const [errorMsg, setErrorMsg] = useState("");
  const [elapsed, setElapsed] = useState(0);

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
        }
      })
      .catch(() => {});
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
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
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

  const stopRecording = useCallback(() => {
    const rec = recorderRef.current;
    if (!rec) return;
    if (timerRef.current) clearInterval(timerRef.current);
    rec.onstop = async () => {
      rec.stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: rec.mimeType });
      const base64 = await new Promise<string>((resolve) => {
        const fr = new FileReader();
        fr.onloadend = () => resolve(String(fr.result).split(",")[1]);
        fr.readAsDataURL(blob);
      });
      await submitAnswer({
        audioBase64: base64,
        mimeType: rec.mimeType.split(";")[0] || "audio/webm",
      });
    };
    rec.stop();
  }, [submitAnswer]);

  const advance = useCallback(() => {
    if (!pendingNext) return;
    if (pendingNext.done) {
      localStorage.removeItem("trueseat_session");
      setStage("done");
      return;
    }
    setQuestion(pendingNext.question);
    setPhase(pendingNext.phase);
    setPendingNext(null);
    setTranscript("");
    setTyped("");
    setStage("asking");
  }, [pendingNext]);

  const mm = String(Math.floor(elapsed / 60)).padStart(1, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <main className="min-h-screen bg-[#0e1116] text-[#e8eaf0] flex flex-col">
      <div className="mx-auto w-full max-w-2xl px-6 py-16 flex-1 flex flex-col">
        <div className="mb-10">
          <p className="text-xs tracking-[0.25em] uppercase text-[#7fa6d9]">
            TrueSeat Interview{phase && stage !== "welcome" ? ` · ${phase.replace("_", " ")}` : ""}
          </p>
          {phase && stage !== "welcome" && stage !== "done" && (
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

        {stage === "done" && (
          <div className="my-auto">
            <h1 className="text-3xl font-semibold mb-4">That&apos;s everything.</h1>
            <p className="text-[#a8b0c0] leading-relaxed">
              We&apos;re assembling your dossier now. You&apos;ll get an email when the draft
              is ready for your review, and nothing goes anywhere until you&apos;ve
              approved every word.
            </p>
          </div>
        )}

        {stage === "error" && (
          <div className="my-auto">
            <p className="text-[#E8896A] mb-6">{errorMsg}</p>
            <div className="flex gap-4 items-center">
              {lastPayloadRef.current ? (
                <button
                  onClick={() => submitAnswer(lastPayloadRef.current!)}
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
              {lastPayloadRef.current && (
                <button
                  onClick={() => {
                    lastPayloadRef.current = null;
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
