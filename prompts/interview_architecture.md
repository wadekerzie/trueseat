# TrueSeat Interview Architecture v1

The interview is the product. Claude (claude-opus-4-8) orchestrates it; Gemini (the ears service) transcribes and first-passes any audio; Claude extracts into `schema/dossier.schema.json` via structured outputs.

## Principles

1. **Evidence over claims.** Every capability gets asked: "when did you actually do that, and what exists that shows it?" A claim without a story gets tier 0 and a follow-up.
2. **Stories, not quizzes.** Operating-profile dimensions are inferred from narrated behavior, then cross-checked against self-description. Divergence is flagged in the dossier, not hidden and not "fixed."
3. **Adjudication.** Headline numbers are read back verbatim: "You said $184M over the Ribbon run. Is that the number you will stand behind in any room?" Only confirmed figures get `adjudicated: true`.
4. **The candidate owns every word.** Nothing ships unreviewed (`meta.candidate_reviewed`).
5. **Guardrails.** No clinical or diagnostic labels. No protected-characteristic inference. No proprietary instrument administration (uploads of existing MBTI/DiSC/PI results are artifacts with provenance, nothing more). Constraints and operating profile are sealed by default.

## Session flow (6 phases, ~45-60 min total, resumable)

### Phase 1 - Arc (10 min)
"Walk me through the shape of your career the way you'd tell it to a friend, not a recruiter." Establishes trajectory, voice, and the candidate's own framing. Output: `trajectory.arc`, experience skeleton.

### Phase 2 - Evidence mining (15 min)
For each major role: context ("what was actually going on at the company when you arrived?"), outcomes ("what changed because you were there, and how do you know?"), artifacts ("what exists that shows this: a doc, a deal record, a repo, a press mention, a person?"). Output: `experience[]`, `capabilities[]`, `artifacts[]`, draft `headline_numbers`.

### Phase 3 - Operating profile (15 min)
One story prompt per dimension, personalized by what phases 1-2 surfaced:
- pace_and_drive: "Tell me about the last deadline that really mattered. What did the final 48 hours look like?"
- ramp_style: "First 30 days of your last job: how did you actually learn it?"
- communication_cadence: "How often did your last boss hear from you without asking?"
- conflict_behavior: "Last time you disagreed with your boss: what did you do?"
- feedback_response: "Hardest feedback you ever got. What changed after?"
- decision_style: "Tell me about a decision you made with incomplete data."
- energy_map: "Which part of the last role filled the tank, and which part drained it?"
- autonomy_calibration: "Best manager you ever had and worst: what specifically made them so?"
- under_pressure: "Tell me about a project that was failing while you were on it."

Then self-report cross-check: "How would you describe your own working style in a sentence?" Output: `operating_profile.dimensions[]` with alignment flags, draft `manager_manual`.

### Phase 4 - Constraints (5 min, explicitly framed as sealed)
"This section never appears anywhere without your explicit release, and it's what makes matching honest." Compensation floor, geography reality, timing, dealbreakers, search status. Output: `constraints`.

### Phase 5 - Adjudication (5 min)
Read back every headline number and any claim the extractor marked uncertain. Confirm or correct. Output: `adjudicated` flags.

### Phase 6 - Witnesses (5 min, optional)
"Who worked with you closely enough to confirm how you operate? We'll ask them for 5 minutes." Collect 2-3 names + relationships. Output: `operating_profile.micro_references[]` (status: invited).

## Extraction pass

After each phase, Claude runs a structured-output extraction against the dossier schema and merges into the working dossier. Anything below confidence threshold goes on the adjudication list for phase 5. The bridge feature (tailored ATS-clean applications) reads only from the final candidate-approved dossier.

## Symmetric employer interview (week 2)

Same architecture, opposite chair: the hiring manager's actual cadence, how the team fights, what feedback culture exists, real autonomy in the role. Match reports compare operating profiles dimension by dimension.
