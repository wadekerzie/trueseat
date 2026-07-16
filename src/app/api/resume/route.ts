import { NextResponse } from "next/server";
import { extractText, getDocumentProxy } from "unpdf";
import mammoth from "mammoth";

// Free-tier resume upload: parse PDF/docx to text. The text is returned to the
// client and attached to the interview session at /api/interview/start, where
// the interviewer treats it as unverified candidate-provided claims.

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_CHARS = 15000;

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "provide a file field" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "file too large (8MB max)" }, { status: 413 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const name = file.name.toLowerCase();

  try {
    let text: string;
    if (name.endsWith(".pdf") || file.type === "application/pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const extracted = await extractText(pdf, { mergePages: true });
      text = extracted.text;
    } else if (name.endsWith(".docx")) {
      text = (await mammoth.extractRawText({ buffer: buf })).value;
    } else if (name.endsWith(".txt") || file.type.startsWith("text/")) {
      text = buf.toString("utf8");
    } else {
      return NextResponse.json(
        { error: "unsupported format — PDF, docx, or txt" },
        { status: 415 }
      );
    }

    text = text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
    if (text.length < 100) {
      return NextResponse.json(
        { error: "couldn't extract readable text — is this a scanned image?" },
        { status: 422 }
      );
    }
    return NextResponse.json({
      text: text.slice(0, MAX_CHARS),
      chars: Math.min(text.length, MAX_CHARS),
      truncated: text.length > MAX_CHARS,
    });
  } catch (err) {
    console.error("resume parse failed:", err);
    return NextResponse.json({ error: "could not parse that file" }, { status: 422 });
  }
}
