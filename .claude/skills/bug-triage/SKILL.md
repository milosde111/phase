# Bug Triage System — Operator Reference

## Quick Commands

```bash
# Full pipeline (fetch new Discord messages → extract → triage → render)
bun scripts/sync-bug-reports.ts fetch
bun scripts/sync-bug-reports.ts extract
bun scripts/sync-bug-reports.ts triage
bun scripts/sync-bug-reports.ts render

# Check a specific card's parser status
jq '.["card name"]' client/public/card-data.json
jq '.["card name"] | {abilities: [.abilities[]? | select(.effect.type == "Unimplemented")], triggers: [.triggers[]? | select(.mode == "Unknown")]}' client/public/card-data.json

# Regenerate card data (after parser changes)
./scripts/gen-card-data.sh

# Single card debug
cargo run --bin oracle-gen -- data --filter "card name"
```

## GitHub Issue Workflow

```bash
# List open issues by priority
gh issue list --repo phase-rs/phase --state open --label "priority:p0-softlock"
gh issue list --repo phase-rs/phase --state open --label "priority:p1-core-mechanic"

# Close a fixed parser-gap issue only after the reported ability is semantically represented
gh issue close <N> --repo phase-rs/phase --comment "Fixed in <commit>. The reported ability now parses to the expected typed semantics with no Unimplemented fallback."

# Transition issue status
gh issue edit <N> --repo phase-rs/phase --remove-label "status:confirmed" --add-label "status:fixed-unreleased"
gh issue edit <N> --repo phase-rs/phase --remove-label "status:fixed-unreleased" --add-label "status:needs-runtime-verify"

# After runtime verification passes
gh issue close <N> --repo phase-rs/phase --comment "Verified in gameplay. Closing."
gh issue edit <N> --repo phase-rs/phase --remove-label "status:needs-runtime-verify" --add-label "status:verified"
```

### Mandatory Post-Fix Review Gate — Isolated Reviewer Required

Every code fix made during bug triage must pass an **isolated reviewer agent's** application of `.claude/commands/review-impl.md` before the fix is committed, marked fixed, or described as complete.

**Self-review by the implementing agent is NOT sufficient.** Multiple commits during the 2026-05-11 bug-triage rounds passed implementer self-review but had real issues caught only by a fresh-context reviewer (CR hallucinations, tests bypassing the pipeline they claim to exercise, predicate-narrowness latent bugs, missing CR sub-parts that don't exist). Implementers rationalize their own choices; fresh-context reviewers do not.

How to apply:

```bash
# After the implementer ships a commit:
git log --oneline -1   # capture the SHA

# Spawn an isolated code-quality-reviewer agent (NOT the implementer) with:
#   - the commit SHA
#   - the review charter from .claude/commands/review-impl.md
#   - explicit "you have not seen the implementation" framing
```

The reviewer must read the diff (`git show <sha>`) with fresh context and apply the `/review-impl` checklist. Required focus areas:

- Missing sibling coverage / parameterization smells
- Overly broad parser or runtime semantics
- **CR annotation correctness** (mandatory grep-verification — see next section)
- **Test rigor** (runtime tests must drive the engine pipeline — see Runtime Test Discipline below)
- Hidden state leaks
- Card-specific fixes that should have been modeled as reusable building blocks

If the reviewer flags issues:
- Send them back to the implementer via `SendMessage` (if still alive) for inline fix in a follow-up commit
- Re-spawn isolated review on the fixup commit's diff
- Repeat until the review is clean (typically 1-2 rounds in practice)

Do NOT transition GitHub issues to `fixed-unreleased`, `needs-runtime-verify`, `verified`, or closed until the isolated review is clean.

### CR Annotation Verification — Mandatory Grep-Proof

Every CR (Comprehensive Rules) number written into engine code MUST be grep-verified against `docs/MagicCompRules.txt` before the annotation is committed. This is non-negotiable — CR hallucinations have been a recurring failure mode across multiple keyword-synthesis commits.

Documented hallucinations from the 2026-05-11 session:
- `CR 702.93b` and `CR 702.79b` for Undying/Persist multi-instance — **subparts do not exist** (both keywords have only subpart `a`)
- `CR 701.16b` for sacrifice "as many as possible" — **subpart does not exist** AND **701.16 is Investigate, not Sacrifice** (701.21 is the sacrifice rule)
- `CR 702.122` for Fabricate — **wrong rule number** (702.122 is Crew; Fabricate is 702.123)
- `CR 702.85` for Annihilator — **wrong rule number** (702.85 is Cascade; Annihilator is 702.86)
- `CR 609.3` for optional triggered abilities — **wrong rule** (609.3 is partial-execution; 603.5 is the optional-trigger rule)
- `CR 608.2b` proposed as substitute for "as many as possible" — **wrong rule** (608.2b is target legality re-checking; 609.3 is the correct rule for "do as much as possible")

The pattern: LLMs infer-by-analogy that subparts like `X.Yb` SHOULD exist describing some edge case (multi-instance redundancy, fast-path partial-execution, etc.). They frequently don't. The comp rules are sparsely structured; many keyword rules have only subpart `a`.

**Before writing any CR annotation:**

```bash
grep -n "^<rule_number>" docs/MagicCompRules.txt
```

**Briefs given to implementer agents must include**:

1. An explicit list of grep commands for every CR likely to be cited
2. The acceptance criterion: "Paste the grep output line for every CR cite in your final report"
3. The session memory pointer: `feedback_cr_subpart_hallucination.md`

**Briefs given to isolated reviewer agents must include**:

1. The full list of past hallucination patterns (above) to specifically check for
2. The acceptance criterion: "Grep-verify every CR annotation in the diff. Any cite you cannot find at the cited line is a BLOCKER."

**Safe-default citation patterns**:

| Scenario | Citation |
|----------|----------|
| Multi-instance keyword redundancy | `CR 113.2c` (objects function with all their abilities) + absence of explicit redundancy clause analogous to CR 702.2f (deathtouch) / CR 702.9c (flying) |
| Optional triggered abilities ("you may") | `CR 603.5` (NOT `CR 609.3`) |
| Sacrifice action mechanic | `CR 701.21a` (NOT `CR 701.16` — that's Investigate) |
| "Do as many as possible" partial execution | `CR 609.3` |
| Target legality at resolution | `CR 608.2b` |
| Defending player (per-attacker, not aggregate) | `CR 508.5 / 508.5a` (NOT `CR 506.3d` — that's a specific creature-ETB scenario) |
| LKI for dies-trigger conditions | `CR 603.10a` (leaves-the-battlefield look-back) + `CR 400.7` (LKI semantics) |
| As-enters replacement timing | `CR 614.1c` |
| Counters lost on zone change | `CR 122.2` |

If you find a cite the implementer wrote that isn't in this table or in `MagicCompRules.txt`, treat it as a hallucination until proven otherwise.

### Runtime Test Discipline — Drive the Pipeline

Runtime tests for synthesized definitions (replacements, triggers, effects) **MUST drive the engine through the pipeline the synthesis is consumed by**. Tests that pre-construct expected state — bypassing the pipeline — prove nothing about pipeline correctness; they pass for the wrong reasons.

Documented anti-patterns from the 2026-05-11 session:
- **Fabricate runtime tests** injected `GameEvent::ZoneChanged` directly into `process_triggers`, bypassing cast → stack → resolve → ETB-replacement-window. Filed #357 to retrofit real end-to-end tests.
- **Modular `etb_replacement_starts_object_with_n_p1p1_counters`** directly inserted counters into `obj.counters` via a helper, bypassing the synthesized `ReplacementEvent::Moved` entirely. Test asserted both the replacement's shape AND the helper's manual mutation — proving consistency between two things the implementer wrote, not that the engine fires the replacement.
- **Modular `dies_transfers_modified_counter_count_after_hardened_scales`** manually mutated `obj.counters = 2` before death, never installing a Hardened Scales replacement. Proved LKI captures the live count, but NOT that Hardened Scales interacts correctly with Modular's ETB.
- **Modular `in_multiplayer_can_target_opponents_artifact_creature`** used `GameState::new_two_player`, not 3+ players. The name overpromised multiplayer-correctness.

The decision rule:

| Test type | What it asserts | What it proves |
|-----------|----------------|----------------|
| **SHAPE test** | The synthesized `ReplacementDefinition` / `TriggerDefinition` has the expected fields (correct event, valid_card, execute body) | The AST emitter produces the right structure. Valuable but limited. |
| **RUNTIME test** | After driving the engine through the relevant action (`move_to_zone`, `cast_spell`, `process_triggers` triggered by a real action, SBA resolution), the observable game state matches expectations | The engine pipeline consumes the synthesis correctly. The only kind of test that proves integration. |

**Rules for runtime tests**:

1. Identify the pipeline entry point you're testing (e.g., `move_to_zone(obj_id, Battlefield)` for ETB replacements; `state.declare_attackers(...)` for attack triggers).
2. Install the synthesized definition on the relevant `CardFace` / `GameObject` BEFORE driving the engine.
3. Drive the engine through the entry point — let it produce the observable state.
4. Assert against state the engine produced. Do NOT manually mutate `obj.counters`, `obj.tapped`, `obj.controller`, etc. to satisfy preconditions the engine should have produced.

**Specific anti-patterns to reject in review**:

- Helper functions that insert game-state values to satisfy a precondition the engine should have produced
- "Multiplayer" tests using a 2-player `GameState`
- Trigger tests calling `process_triggers(SyntheticEvent)` directly instead of producing the event via the game action that should emit it
- Replacement tests asserting the replacement's shape and assuming that proves the engine fires it
- LKI tests mutating the live counter map then asserting LKI reads it — proves the LKI cache reads from the live map, NOT that LKI captured pre-death state

When the pipeline-driving harness doesn't exist yet, **build it as part of the work** (per the No Default Deferral rule below). Cascade synthesis has such a harness; mirror it. Do not split "real tests" into a follow-up issue when the harness can be built in the same commit.

Session memory pointer: `feedback_runtime_tests_must_drive_pipeline.md`.

### No Default Deferral — Build the Missing Infrastructure

When a card bug requires a missing engine primitive (new enum variant, parser combinator, runtime resolver case, LKI plumbing, target filter, etc.), **build the primitive as part of the fix**. Use the reported card as the validating consumer. Do NOT file a deferred follow-up issue and ship a half-fix.

Deferral is reserved for genuinely massive work:
- Multi-day rewrites cross-cutting through stack / SBA / replacement pipelines
- Architectural primitives that need their own RFC (e.g., Soulbond pair-binding, DSK Rooms door-unlock)
- Work that requires user-facing UI design decisions

A few hundred LOC of typed plumbing in the engine crate is NOT deferral-worthy. Examples from the 2026-05-11 session where the agent (correctly) built infrastructure instead of deferring:

- #353 Undying/Persist: investigated whether LKI plumbing existed for dies-trigger counter inspection. It did (`apply_zone_exit_cleanup` snapshots counters into `LKISnapshot.counters`). Zero new infrastructure needed.
- #351 Modular: discovered `resolve_counters_on_scope::Source` had a CR-correctness bug (live-state short-circuit bypassing LKI). Fixed it as part of the Modular work rather than filing as a separate ticket.
- #352 Annihilator: needed "defending player for this attack" target wiring. Reused existing `ControllerRef::DefendingPlayer` (verified by tracing through `combat::defending_player_for_attacker`). Zero new variants.

What gets filed as a separate issue:
- Architectural design choices that affect multiple keywords/cards uniformly (e.g., #359 KeywordTriggerInstaller registry — affects all build-time-synthesized triggered keywords)
- Pre-existing bugs in unrelated files discovered during review (file as a cleanup ticket; don't expand the current commit's scope into other modules)
- Pi-round-class refactors lifting stringly-typed AST fields to typed enums (e.g., #364 CounterType Π-8 lift)

**In briefs to implementer agents, include**:

> If your work requires a missing primitive, enum variant, parser combinator, or runtime path: **build it as part of this commit**. Use the reported card as the validating consumer. Defer ONLY if the work is genuinely multi-day cross-cutting (and explain why in your report).

Session memory pointer: `feedback_no_default_deferral.md`.

### Multi-Agent Safe Staging

When other engine-implementer agents are running concurrently on shared files (especially `crates/engine/src/database/synthesis.rs`, `types/ability.rs`, parser modules), **never use `git add <file>` for surgical edits** — it sweeps any concurrent in-progress edits into your commit, polluting the audit trail.

Surgical staging options:

```bash
# Interactive hunk selection
git add -p crates/engine/src/database/synthesis.rs

# Non-interactive: write the patch and apply through the index
git diff crates/engine/src/database/synthesis.rs > /tmp/my-edit.patch
# (manually trim /tmp/my-edit.patch to only your hunks)
git apply --cached /tmp/my-edit.patch
```

If a `git add <file>` collision happens anyway:

1. Don't `git reset --hard` — preserves working-tree but reset can race with concurrent file writes
2. Do `git commit --amend -m "<honest message describing both swept-in changes>"` to update the commit narrative
3. SendMessage the other agent so it knows part of its work landed in your commit and to trust `git diff HEAD` for what remains to commit

Documented collision from 2026-05-11: a small Fabricate-timing comment annotation (#358) staged via `git add crates/engine/src/database/synthesis.rs` swept the #353 Undying/Persist agent's in-progress synthesis scaffold into the same commit. Recovery: amended commit message to honestly describe both changes; agent finished its remaining work (tests + registration) in a follow-up commit.

### GitHub Comment Standard

GitHub comments must be concise, user-facing status updates. Do not paste local command output, long command transcripts, local machine paths, target directories, or exhaustive verification command lists into issues. Summarize the evidence at the semantic level instead:
- Good: "Fixed in <commit>. The reported ability now parses as a typed ProduceMana replacement with a tapped-for-mana scope, and regression tests cover both multiplied and non-multiplied mana production."
- Bad: "Verification: `CARGO_TARGET_DIR=... cargo test ...`, `cargo run ...`, `git diff --check`" followed by command details or output.

Keep raw command details in the local working notes or final Codex response when useful, not in GitHub. For issue updates, mention only the commit, the reported behavior now covered, and whether targeted parser/runtime evidence exists.

## Status Lifecycle

```
needs-triage → confirmed → in-progress → fixed-unreleased → needs-runtime-verify → verified → closed
                         → stale → closed
                         → wont-fix → closed
                         → duplicate → closed
```

## Resync Workflow (periodic maintenance)

Run this after parser/engine changes to update triage state:

### Step 1: Regenerate card data
```bash
./scripts/gen-card-data.sh
```

### Step 2: Re-run coverage cross-reference
Spawn a Sonnet agent to re-read `triage/llm-triage-items.jsonl` and cross-reference against the updated `client/public/card-data.json`. Write results to `triage/coverage-crossref.jsonl` and `triage/coverage-crossref-summary.md`.

### Step 3: Identify candidates for verification
Compare the new cross-reference against open GitHub issues. Parser coverage is only a candidate signal:
- If the bug was a parser gap → inspect the reported ability and verify the typed AST/IR represents the reported semantics. Close only after that targeted semantic check passes.
- If the bug was a runtime issue → do not mark fixed from parser coverage. Inspect the relevant runtime code and preferably add/run a reproduction test. Transition only after targeted evidence exists.

### Step 4: Fetch new Discord messages
```bash
bun scripts/sync-bug-reports.ts fetch
```
If new messages exist, re-run extract → triage → render and review new items.

### Step 5: Update dashboard
```bash
bun scripts/sync-bug-reports.ts render
```

## Oracle Text Sourcing — MANDATORY

**Every Oracle text reference in a GitHub issue, comment, or triage note MUST be copied verbatim from `client/public/card-data.json`.** Never quote Oracle text from memory, the user's Discord message, Scryfall, or training data. The card database is the only authoritative source — using anything else risks filing issues against the wrong card text and wasting fix cycles.

```bash
# REQUIRED before quoting Oracle text in any issue body or comment:
jq -r '.["card name"] | .oracle_text' client/public/card-data.json
```

If `oracle_text` is `null` or the card key is missing, do NOT guess — flag the card-data lookup failure in the issue and stop. A missing entry is itself a bug worth reporting (likely a card-data pipeline gap).

When filing or updating an issue, include an explicit **Oracle text (verified from `client/public/card-data.json`)** section quoting the text you looked up. This makes the verification visible to reviewers and prevents downstream agents from re-introducing wrong text.

If you discover an existing issue references wrong Oracle text, fix it as part of the next triage pass — wrong card text in an issue is worse than no quote, because it sends fixers chasing the wrong semantics.

## Investigating Whether a Bug Is Fixed

### Evidence Standard

User reports are presumed real unless there is strong contradictory evidence. Do not mark an issue `likely_fixed`, `fixed-unreleased`, `verified`, or closed from parser coverage alone.

`fully_parsed` only means the parser did not emit `Unimplemented` or `Unknown`. It does not prove the card behaves correctly: text can be swallowed, parsed into overly generic effects, attached to the wrong subject/controller/zone, or represented with the wrong typed semantics.

Acceptable evidence depends on the report type:
- Parser-gap report: the specific reported Oracle clause parses into the expected typed AST/IR/effect, with correct subject, controller, target, zone, condition, quantity, and optional/otherwise wiring.
- Runtime/engine report: a targeted runtime code inspection or regression test proves the reported behavior is handled correctly.
- AI/frontend/deckbuilder report: inspect the subsystem that owns the behavior; card parser coverage is not evidence for these.

When evidence is weaker than this, keep or create the GitHub issue and label it `status:confirmed` or `status:needs-repro`. In notes, say what evidence is missing instead of calling it fixed.

Before calling any bug fixed, run the mandatory post-fix review gate above. Regressions discovered by review are part of the same bug-triage task and must be resolved before issue status changes.

### Parser-gap bugs (area:parser)
1. Check the card: `jq '.["card name"]' client/public/card-data.json`
2. Look for `Unimplemented` effects or `Unknown` triggers
3. Verify the specific ability mentioned in the bug has the expected typed semantics, not just a real effect type
4. If the ability is represented by `GenericEffect`, overly broad filters, wrong controller/target/zone, missing conditions, or swallowed clauses, the parser gap is still open

### Runtime/engine bugs (area:engine)
1. Read the bug description
2. Find the relevant handler in `crates/engine/src/game/effects/` or `crates/engine/src/game/`
3. Check if the described behavior is handled correctly, including the exact subject/controller/zone/timing from the report
4. Best: write a test that reproduces the bug scenario → if the test proves the reported bad behavior cannot occur, the bug is fixed

### AI bugs (area:ai)
1. Check `crates/phase-ai/` for the relevant evaluation/action-generation logic
2. AI bugs are rarely caught by parser coverage — they need gameplay testing

## Triage Data Files

| File | Description | Gitignored |
|------|-------------|------------|
| `triage/raw/discord-messages.jsonl` | Raw Discord messages (775+) | yes |
| `triage/report-items.jsonl` | Heuristic-extracted report items | yes |
| `triage/triage-items.jsonl` | Heuristic triage classifications | yes |
| `triage/llm-triage-items.jsonl` | LLM (Sonnet) triage — 333 items, best quality | yes |
| `triage/coverage-crossref.jsonl` | Cross-reference against parser coverage | yes |
| `triage/coverage-crossref-summary.md` | Human-readable summary | yes |
| `triage/p0-verification.md` | Manual spot-check of P0 likely-fixed bugs | yes |
| `triage/unknown-card-mapping.json` | Card name corrections | yes |
| `triage/no-card-bugs.md` | Engine/UI bugs not tied to cards | yes |
| `triage/threads-compact.json` | Compact thread data for LLM agent input | yes |
| `triage/sync-state.json` | Incremental fetch cursors | yes |
| `triage/dashboard.md` | Generated dashboard | yes |

## Label Taxonomy

| Group | Labels | Purpose |
|-------|--------|---------|
| status | needs-triage, needs-repro, confirmed, in-progress, fixed-unreleased, needs-card-data-regen, needs-runtime-verify, verified, stale, duplicate, wont-fix | Lifecycle |
| area | engine, parser, frontend, ui, ai, card-data, deckbuilder, multiplayer, infra | Ownership |
| priority | p0-softlock, p1-core-mechanic, p1-infinite-loop, p2-wrong-game-result, p2-interaction, p3-card-specific, p3-edge-case | Urgency |
| mechanic | triggered-abilities, mana, combat, tokens, costs, zone-change, continuous-effects, keyword, replacement-effects, counters, layers, attachments, modal, search, card-data-regen, ai-policy, targeting | Subsystem |
| source | discord, github, playtesting | Provenance |
| resolution | split, merged, upstream, cant-reproduce, by-design | Closure reason |
| special | collector | Omnibus issue marker |
