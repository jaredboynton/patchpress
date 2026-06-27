# patchpress

**Native Claude Code compaction hands your entire session to a frontier model for compaction. It's slow. It's expensive. 

Patchpress swaps in a cheap, fast model that cites its sources, preserves a perfect narrative, and uses hashed extraction of verbatim sections — and can compact by 20x in roughly ~0.75s per 100k of pre-compact tokens.**

What is context compaction, really? When a Claude Code session fills its window, it summarizes the older turns and continues from the summary. The native path sends the whole transcript to the main model and asks for prose. It is slow, it bills frontier-model rates every time it fires, and the result is an opaque paragraph that quietly drops the exact file paths, command flags, and decisions you needed it to keep.

So we asked a different question: what if compaction were an **extraction** problem instead of a **writing** problem? What if a small, fast, cheap model rendered the transcript densely, emitted a structured handoff that **cites exact source-line spans**, and the harness **rehydrated those spans verbatim** from the original JSONL? The model never has to remember a path correctly. It only has to point at the line the path lives on.

This repo is two things:

- **patchpress** — the patcher that rewrites the Claude Code binary in place so *both* compaction triggers (automatic compaction and the manual `/compact`) run through our harness instead of the native API path.
- **FlashHash** — the compaction *method*: the rendering, prompting, citation, rehydration, and gating stack that lets a flash-tier model beat the frontier path on fidelity, speed, and cost at the same time.

## TL;DR

On the canonical 595,000-token benchmark transcript, the default lane — `gemini-3.1-flash-lite` with the `onto` renderer at minimal thinking — is the single best balance of quality and speed of every model and renderer tested.

| Metric | Value |
| --- | --- |
| Source transcript | **595,000 tokens** (1,066 records, 799 citable) |
| Compacted handoff | **23,556 tokens** (~25x reduction) |
| Wall time | **4.4 s** |
| Deterministic structure score | **100 / 100** |
| Semantic judge (`gpt-5.5`, 3 trials) | **10 / 10** |
| Model | **gemini-3.1-flash-lite** — one call, minimal thinking, temp 0.4 |
| Evidence captured | 32 verified capsules, 26 cited source lines |

Evidence: [`docs/benchmark.md`](docs/benchmark.md). The cheapest model on the board posts the top combined score. That is roughly an **8x speedup** over the same lane on `low` thinking (~31 s) and **20x** over `high` (~94 s), with no measured quality loss — the judge holds 10/10 across trials.

## FlashHash: how it works

FlashHash is not one trick. It is a handful of independent techniques that compose into a pipeline where a weak model behaves like a strong one. Each stage removes a different reason a cheap model would otherwise fail. The name says the shape of it: a **flash**-tier model does the reasoning, and content-**hash**ed line spans anchor every fact back to the source.

| Stage | Technique | What it does |
| --- | --- | --- |
| 1. Render | **`onto`** (arXiv:2604.17512) | Schema-once, row-major, line-numbered framing of the JSONL. Declares the field layout one time, then emits one pipe-delimited metadata row per record — dropping the per-record `key=` repetition the other renderers pay. Cuts provider input tokens ~10-28% and gives the model a stable line number to cite. |
| 2. Compress | **`headtail`** (default) / **`dspc`** (arXiv:2509.13723) | Shrinks stale tool outputs *in the rendered prompt only*. Edit/StrReplace/Write tool inputs and Factory `diffLines` results are rendered as compact unified diffs (no JSON escaping) in both the prompt and rehydrated handoff. DSPC does a TF-IDF coarse filter then a multi-signal importance pick; the full JSONL is untouched, so rehydration still sees every byte via hash-anchored spans. |
| 3. Extract | **Structured handoff with span citation** | One JSON-schema-constrained call. The model writes a sectioned handoff — current work, rules and invariants, plans and task state, promises made, evidence capsules — and every claim must cite one or more exact `{start_line, end_line}` source spans. |
| 4. Rehydrate | **Hash-anchored span rehydration** (`warp-guided-span-rehydration`) | Each source line is content-hashed up front (`line-hashes.tsv`); the harness pulls the cited spans *verbatim* from the original JSONL and renders them into the handoff. Exact file paths, flags, RPC names, and version numbers survive because the model pointed at them rather than retyping them. |
| 5. Gate | **Density gate + reask-until-pass** | A deterministic gate counts evidence capsules and distinct cited lines. If the handoff is too thin, the harness re-asks with corrective feedback (and model-specific prompt adaptations) until it clears — or emits the best attempt rather than failing. This is what makes a flash-tier model reliably dense. |
| 6. Score | **Two independent signals** | Every run is scored two ways that fail for different reasons (below). |

The result is a handoff that is small, fast, cheap to produce, and — because the load-bearing literals are rehydrated rather than paraphrased — accurate enough to carry a real engineering project across a compaction boundary without losing the thread.

## The two signals

"The model wrote a plausible summary" and "the summary actually preserved the session" are two different things, and they fail for different reasons. FlashHash scores both, separately.

- **The deterministic gate** (`scripts/score-compaction-result.mjs`, `deterministic-compaction-score.v2`) is pure code: integrity echo, evidence-capsule count, cited-line coverage, exact-literal recovery, footprint. It cannot be charmed by good prose. The default lane scores **100/100**.
- **The semantic judge** (`scripts/judge-compaction-result.mjs`) is `gpt-5.5` at medium reasoning, 3 trials, per-dimension median, asked whether a fresh session could actually continue the work from this handoff. The default lane scores **10/10**.

A handoff has to pass both. Thin handoffs can sometimes fool the judge; verbose ones can pass structure while reading like mush. Requiring both is the whole point.

## patchpress: the patcher

The method is useless in practice unless Claude Code actually calls it. patchpress makes it do so by patching the compiled binary in place.

Claude Code has **two** compaction code paths, and they are easy to miss: automatic compaction reaches the shared summarizer (`Sel`), while the manual `/compact` command — with the default feature gate off — takes a separate *reactive* path (`_kd`) that bypasses `Sel` entirely. Patching only the first leaves `/compact` on native summarization. patchpress patches **both**:

- It locates each function in the binary's JS trailer (`Sel` by its destructured signature, `_kd` by the unique `forkLabel:"reactive-compact"` content marker), brace-matches the body, and overwrites it with a byte-aligned redirect padded to the exact original length.
- Each redirect spawns the harness, reads the handoff, and reconstructs the function's native return contract so Claude Code is none the wiser.
- It backs up the clean binary, re-signs with `codesign`, and a launcher shim re-applies the patch on every Claude Code update so it survives version bumps.

Validated live: a real `/compact` in a patched session compacts through the FlashHash pipeline, and the continued session reads the inserted summary correctly.

## Use it

The harness runs standalone — you do not have to patch anything to try the method.

```sh
# Compact a transcript with the default (winning) lane
node scripts/compact-full-transcript.mjs \
  --provider gemini --model gemini-3.1-flash-lite \
  --transcript-renderer onto \
  --input transcripts/claude-main-session-81c06368-approx-595k-tokens.jsonl \
  --out-dir runs/demo

# Score it two ways
node scripts/score-compaction-result.mjs runs/demo     # deterministic /100
node scripts/judge-compaction-result.mjs runs/demo     # semantic judge /10
```

Provider credentials load from a gitignored `.env` with no manual setup; `--provider` also accepts `codex`, `xai`, and `mantle` (see [`AGENTS.md`](AGENTS.md)).

To patch Claude Code itself so live sessions use it:

```sh
# Easiest: install via npm (installs the stable shim + config + patches the latest Claude)
npx patchpress install

# Or from this repo:
node scripts/cli.mjs install                # install shim + config + patch
node scripts/cli.mjs patch --dry-run        # locate both anchors, check byte budgets
node scripts/cli.mjs patch                  # apply + codesign
node scripts/cli.mjs restore                # revert both patches
```

The redirect baked into the binary calls a **stable indirection shim** at `~/.local/share/patchpress/run-compact.mjs`, which reads the current lane (provider/model/renderer) from `~/.local/share/patchpress/config.json` and execs the latest compaction script from the installed `patchpress` package. So you can swap the lane by editing `config.json`, or update the harness by running `npm update -g patchpress` — **without re-patching the binary**. Script body edits, model swaps, and renderer changes all flow through the shim.

```sh
# Edit the lane without re-patching:
$EDITOR ~/.local/share/patchpress/config.json

# Update the harness to the latest published version:
npm update -g patchpress
```

## When this is worth it

Good fits:

- Long agent or coding sessions where losing an exact path, flag, or decision is the real cost of compaction.
- Anyone paying frontier-model rates for compaction who would rather pay flash-tier rates for a better result.
- Compaction or agent-memory research that wants two independent, mechanical quality signals instead of vibes.

Bad fits:

- Sessions short enough that native compaction is already free and fine.
- Environments where you cannot run a local Node harness or re-sign a binary.
- Anything that needs a provider-native opaque compaction blob (those are bound to the model that made them and cannot port a session across providers — which is exactly why FlashHash uses structured handoffs instead).

## Repo map

```text
scripts/cli.mjs                      patchpress CLI: install / patch / restore / compact
scripts/install.mjs                  installs the stable shim + config + patches the binary
scripts/compact-full-transcript.mjs  the harness: render -> extract -> rehydrate -> gate
scripts/patcher/patch-claude.mjs     dual-anchor binary patcher (Sel + _kd), codesign
scripts/patcher/run-compact.mjs      STABLE INDIRECTION SHIM (the one path baked into the binary)
scripts/patcher/launcher-shim.mjs    re-applies the patch on every Claude Code update
scripts/score-compaction-result.mjs  deterministic structure score /100
scripts/judge-compaction-result.mjs  semantic judge /10 (gpt-5.5)
scripts/renderer-prompt-guides.mjs   per-renderer prompt framing
scripts/prompt-adaptation.mjs        model-specific density adaptations
.github/workflows/ci.yml             CI: test gate on push; publish to npm on tag (trusted publishing / OIDC, no token)
docs/benchmark.md                    canonical scored results, all models x renderers
transcripts/                         the 595k-token benchmark source
runs/                                per-run artifacts (handoff.md, result.json, ...)
```

## Releases

Published to npm as [`patchpress`](https://www.npmjs.com/package/patchpress). New versions cut on `v*` tags publish from CI via **npm trusted publishing** (OIDC): GitHub proves the workflow's identity to npm, npm issues a single-use publish credential, and the package ships with automatic provenance attestations. There is no long-lived `NPM_TOKEN` to rotate or leak. One-time trust config links `jaredboynton/patchpress` + workflow `ci.yml` on the [package access page](https://www.npmjs.com/package/patchpress/access).

## Status

This is a research package, not an official SDK. It patches a third-party binary and depends on the internal shape of a specific Claude Code build; updates can move the anchors. The numbers here are grounded evidence for the recorded benchmark run, not a contract. Keep a backup, test on a throwaway session first, and trust a lane only after it passes the scorer and judge on a transcript you actually care about.
