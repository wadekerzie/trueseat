// X25: outbound email via the SendGrid v3 REST API (no SDK dependency).
// Everything no-ops gracefully when SENDGRID_API_KEY is unset, so the
// pipeline works link-in-page-only until the key is provisioned.

const SENDGRID_KEY = process.env.SENDGRID_API_KEY;
const FROM_EMAIL = process.env.DOSSIER_FROM_EMAIL || "wade@kerzie.ai";
const FROM_NAME = "TrueSeat";
const FOUNDER_EMAIL = process.env.FOUNDER_NOTIFY_EMAIL || "wade@kerzie.ai";

export function emailConfigured(): boolean {
  return Boolean(SENDGRID_KEY);
}

export async function sendEmail(
  to: string,
  subject: string,
  text: string
): Promise<boolean> {
  if (!SENDGRID_KEY) return false;
  try {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SENDGRID_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: FROM_EMAIL, name: FROM_NAME },
        reply_to: { email: FOUNDER_EMAIL },
        subject,
        content: [{ type: "text/plain", value: text }],
      }),
    });
    if (res.status !== 202) {
      console.error(`sendgrid send failed: ${res.status} ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("sendgrid send error:", err);
    return false;
  }
}

export function dossierUrl(dossierId: string): string {
  return `https://trueseat.io/d/${dossierId}`;
}

export async function emailCandidateDraftLink(
  candidateEmail: string,
  candidateName: string | undefined,
  dossierId: string
): Promise<boolean> {
  const first = candidateName?.split(" ")[0];
  return sendEmail(
    candidateEmail,
    "Your TrueSeat draft dossier is ready",
    `${first ? `${first} — your` : "Your"} draft dossier is ready to review:

${dossierUrl(dossierId)}

It's a draft. Read every word; nothing publishes until you've approved it. Reply to this email with anything that's wrong or missing.

— TrueSeat`
  );
}

export async function emailFounderDossierReady(
  sessionId: string,
  candidateName: string | undefined,
  dossierId: string,
  candidateEmailed: boolean
): Promise<boolean> {
  return sendEmail(
    FOUNDER_EMAIL,
    `TrueSeat: dossier generated${candidateName ? ` for ${candidateName}` : ""}`,
    `A dossier just auto-generated.

Candidate: ${candidateName ?? "(no name on session)"}
Session: ${sessionId}
Draft: ${dossierUrl(dossierId)}
Candidate emailed: ${candidateEmailed ? "yes" : "no (no email captured or send failed)"}

Review pass, then approve with scripts/approve-dossier.mjs.`
  );
}
