"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The 5-minute witness reference: same tap-talk-tap voice loop as the candidate
// interview, but a fixed personalized script and no accounts — the link is the auth.

type Stage =
  | "loading"
  | "welcome"
  | "asking"
  | "recording"
  | "processing"
  | "confirm"
  | "done"
  | "error";

const ACCENT = "#6B9FD4";

function pickMimeType(): string {
  const candidates = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(c)) {
      return c;
    }
  }
  return "";
}

export default function WitnessClient({ token }: { token: string }) {
  const [stage, setStage] = useState<Stage>("loading");
  const [candidateName, setCandidateName] = useState("");
  const [question, setQuestion] = useState("");
  const [qNum, setQNum] = useState(1);
  const [qTotal, setQTotal] = useState(6);
  const [transcript, setTranscript] = useState("");
  const [pendingNext, setPendingNext] = useState<{
    question: string;
    questionNumber: number;
    done: boolean;
  } | null>(null);
  const [typed, setTyped] = useState("");
  const [showTyping, setShowTyping] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [elapsed, setElapsed] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPayloadRef = useRef<Record<string, string> | null>(null);

  useEffect(() => {
    fetch(`/api/witness/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        setCandidateName(d.candidateName);
        setQuestion(d.question);
        setQNum(d.questionNumber);
        setQTotal(d.totalQuestions);
        setStage(d.done ? "done" : "welcome");
      })
      .catch(() => {
        setErrorMsg("This reference link isn't valid anymore.");
        setStage("error");
      });
  }, [token]);

  const submitAnswer = useCallback(
    async (payload: Record<string, string>) => {
      lastPayloadRef.current = payload;
      setStage("processing");
      try {
        const res = await fetch(`/api/witness/${token}/answer`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        lastPayloadRef.current = null;
        setTranscript(data.transcript);
        setPendingNext({
          question: data.question,
          questionNumber: data.questionNumber,
          done: data.done,
        });
        setStage("confirm");
      } catch {
        setErrorMsg("That answer didn't go through — your recording is still here.");
        setStage("error");
      }
    },
    [token]
  );

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
      setStage("done");
      return;
    }
    setQuestion(pendingNext.question);
    setQNum(pendingNext.questionNumber);
    setPendingNext(null);
    setTranscript("");
    setTyped("");
    setStage("asking");
  }, [pendingNext]);

  const mm = String(Math.floor(elapsed / 60));
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <main className="min-h-screen bg-[#0e1116] text-[#e8eaf0] flex flex-col">
      <div className="mx-auto w-full max-w-2xl px-6 py-16 flex-1 flex flex-col">
        <div className="mb-10">
          <p className="text-xs tracking-[0.25em] uppercase text-[#7fa6d9]">
            TrueSeat Reference
            {stage !== "welcome" && stage !== "loading" && stage !== "done"
              ? ` · question ${qNum} of ${qTotal}`
              : ""}
          </p>
          {stage !== "welcome" && stage !== "loading" && stage !== "done" && (
            <div className="flex gap-1.5 mt-3" aria-label={`Question ${qNum} of ${qTotal}`}>
              {Array.from({ length: qTotal }).map((_, i) => (
                <span
                  key={i}
                  className={`h-1 flex-1 max-w-12 rounded-full ${
                    i < qNum - 1
                      ? "bg-[#6B9FD4]"
                      : i === qNum - 1
                      ? "bg-[#8ab4e0] animate-pulse"
                      : "bg-[#2a3242]"
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        {stage === "loading" && (
          <p className="my-auto text-[#a8b0c0] animate-pulse">Loading…</p>
        )}

        {stage === "welcome" && (
          <div className="my-auto">
            <h1 className="text-3xl font-semibold mb-4">
              Five minutes for {candidateName}.
            </h1>
            <p className="text-[#a8b0c0] leading-relaxed mb-3">
              {candidateName} asked us to talk with you — {qTotal} short questions about
              how they actually work. Tap the button, talk, tap when you&apos;re done;
              you&apos;ll see exactly what we heard after every answer.
            </p>
            <p className="text-[#a8b0c0] leading-relaxed mb-8">
              Everything you say goes into a record {candidateName} controls, in your
              words. You can skip any question. Starting means you&apos;re okay with that.
            </p>
            <button
              onClick={() => setStage("asking")}
              className="rounded-md px-6 py-3 font-medium text-[#0e1116]"
              style={{ backgroundColor: ACCENT }}
            >
              I&apos;m in — start
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
                  className="rounded-full w-20 h-20 flex items-center justify-center text-3xl"
                  style={{ backgroundColor: ACCENT }}
                  aria-label="Start recording"
                >
                  🎙
                </button>
                <div className="flex gap-5">
                  <button
                    onClick={() => setShowTyping(true)}
                    className="text-sm text-[#6d7585] underline underline-offset-4"
                  >
                    Type instead
                  </button>
                  <button
                    onClick={() => submitAnswer({ text: "(witness chose to skip this question)" })}
                    className="text-sm text-[#6d7585] underline underline-offset-4"
                  >
                    Skip this question
                  </button>
                </div>
              </div>
            )}

            {stage === "asking" && showTyping && (
              <div className="flex flex-col gap-4">
                <textarea
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  rows={5}
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
                  Recording {mm}:{ss} — tap to finish.
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
                {pendingNext?.done ? "Finish" : "That's right, next"}
              </button>
            </div>
          </div>
        )}

        {stage === "done" && (
          <div className="my-auto">
            <h1 className="text-3xl font-semibold mb-4">That&apos;s all — thank you.</h1>
            <p className="text-[#a8b0c0] leading-relaxed">
              Your words go to {candidateName || "the candidate"} exactly as you said
              them. People like you are why the word &quot;reference&quot; still means
              something.
            </p>
          </div>
        )}

        {stage === "error" && (
          <div className="my-auto">
            <p className="text-[#E8896A] mb-6">{errorMsg}</p>
            {lastPayloadRef.current && (
              <button
                onClick={() => submitAnswer(lastPayloadRef.current!)}
                className="rounded-md px-5 py-2.5 font-medium text-[#0e1116]"
                style={{ backgroundColor: ACCENT }}
              >
                Resend that answer
              </button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
