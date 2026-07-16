# Micro-Reference Interview v1 (the 5-minute witness call)

The tier-3 evidence engine. A former colleague confirms operating traits and specific claims in five minutes, by phone (VAPI outbound, week 2-3) or via a one-tap web voice link (same tap-talk-tap component as the candidate interview).

## Design constraints

- Five minutes, hard. Respect for the witness's time is the product's reputation.
- The witness was invited BY the candidate and knows why we're calling. First line confirms consent and that answers are shared with the candidate's dossier.
- Ask about observed behavior, never ask the witness to rank or score. No "on a scale of 1-10."
- Never lead: ask "how did they take hard feedback?" not "they took feedback well, right?"
- The witness can decline any question; partial completions still count as completed with fewer confirmations.
- Output maps to `operating_profile.micro_references[].confirmations` and can raise specific claims/capabilities to tier 3.

## Script skeleton (personalized per candidate by the orchestrator)

1. **Consent + framing (20s).** "Thanks for doing this: five minutes, {candidate} asked us to talk to you, and everything you say goes into a record they control. Ready?"
2. **Relationship anchor (30s).** "How did you and {candidate} work together, and for how long?" (Validates the claimed relationship.)
3. **Claim spot-checks (90s).** Two specific claims from the dossier, asked neutrally: "{candidate} told us {claim}. Were you close enough to that to say what you saw?"
4. **Operating dimensions (2 min).** The two dimensions where the candidate's dossier most needs a witness (chosen by the orchestrator: usually where self-report and stories diverged, or where evidence is thinnest): "Tell me about a time you watched them handle {disagreement with their boss / a failing project / hard feedback}."
5. **The one-question manual (45s).** "If a new manager asked you for one sentence on how to get the best work out of {candidate}, what would it be?"
6. **Close (15s).** "Anything you'd want a future employer to know that I didn't ask?" Thanks, done.

## Extraction

Gemini transcribes; Claude extracts: confirmations (witness's own words, quoted or tightly paraphrased), relationship validation, and any divergence from the candidate's account. Divergences are flagged to the candidate privately first; the candidate chooses whether the reference appears in the dossier at all, but cannot edit the witness's words.
