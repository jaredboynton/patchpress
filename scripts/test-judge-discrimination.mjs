#!/usr/bin/env node
// Meta-validation for the semantic continuation-quality judge.
//
// The judge is only trustworthy if it ranks a deliberately degraded handoff
// below a clean one, and does not penalize edits that preserve meaning. This
// harness builds targeted perturbations from a real run's handoff, judges each
// variant, and asserts a separation bar (every degrading variant scores strictly
// below the clean parent) plus an invariance bar (no quality-preserving variant
// is penalized). Method follows FBI/DHP targeted-perturbation meta-evaluation
// and counterfactual field-ablation (see docs/eval-architecture.md).
//
// Handoff section titles vary by model/renderer, so perturbations match sections
// by role (flexible regex) and inject format-agnostically. A perturbation that
// does not apply to a given handoff (transform leaves the text unchanged) is
// skipped and excluded from the pass/fail bars rather than failing the run.
import { execFile } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const judgeScript = join(repoRoot, "scripts", "judge-compaction-result.mjs");

function argValue(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx === -1 ? fallback : process.argv[idx + 1];
}

const baseDir = resolve(argValue("--run-dir", "runs/fixval-codex-stripped"));
const concurrency = Number.parseInt(argValue("--concurrency", "3"), 10);
const judgeInputFiles = [
  "result.json",
  "handoff-state.json",
  "handoff-manifest.json",
  "handoff.md",
  "summary.rehydrated.md",
];

// Remove the first "## <heading>" section (up to the next "## " or EOF) whose
// heading text matches headingRe. Returns the text unchanged if none matches.
function dropSection(text, headingRe) {
  const lines = text.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^## (.+)$/);
    if (m && headingRe.test(m[1])) {
      start = i;
      break;
    }
  }
  if (start === -1) return text;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i])) {
      end = i;
      break;
    }
  }
  return lines.slice(0, start).concat(lines.slice(end)).join("\n");
}

// Remove task-state lines that mark an open/actionable item (the implicit next
// actions), e.g. "- [pending] ..." / "- [ ] ..." / "[in progress] ...".
function stripOpenTaskLines(text) {
  return text.replace(/^.*\[(?:pending|todo|in[_ -]?progress|open|active|[ ])\].*$/gim, "").replace(/\n{3,}/g, "\n\n");
}

// Insert a sentence as a bullet immediately after the H1 title line.
function injectAtTop(text, sentence) {
  const lines = text.split("\n");
  const h1 = lines.findIndex((l) => /^# /.test(l));
  const at = h1 === -1 ? 0 : h1 + 1;
  lines.splice(at, 0, "", "- " + sentence);
  return lines.join("\n");
}

function replacePath(text, from, to) {
  return text.includes(from) ? text.split(from).join(to) : text;
}

const REAL_PATH = "/Users/jaredboynton/__devlocal/devin-decompile";

const perturbations = [
  { name: "clean", kind: "baseline", expect: null, transform: (t) => t },
  {
    // Genuine ablation: remove explicit next-step sections AND strip the open
    // task lines that otherwise state what to do next.
    name: "drop_next_action",
    kind: "degrade",
    expect: "next_step_actionability",
    transform: (t) => stripOpenTaskLines(dropSection(t, /next step|unresolved|next action/i)),
  },
  {
    // Genuine ablation: durable constraints recur in both a rules section and an
    // intent/constraints section, so drop every constraint-bearing section.
    name: "drop_rules",
    kind: "degrade",
    expect: "constraint_promise_preservation",
    transform: (t) => dropSection(dropSection(t, /rules|invariants/i), /constraint/i),
  },
  {
    // Genuine ablation across handoff formats: file/artifact references recur in
    // dedicated sections, in backtick code spans, and in prose. Drop the listing
    // sections, neutralize path-like code spans, and strip any remaining line that
    // names a filesystem path or a filename, so artifacts are no longer recoverable.
    name: "strip_artifacts",
    kind: "degrade",
    expect: "state_artifact_recoverability",
    transform: (t) => {
      let out = t;
      for (const re of [/active.*(?:file|workspace)/i, /workspace structure/i, /^artifacts?$/i, /evidence index/i]) {
        out = dropSection(out, re);
      }
      out = out.replace(/`[^`]*`/g, (m) =>
        /[/]|\.(py|mjs|js|md|json|proto|bin|toml|ya?ml|sh|rs|txt)\b/.test(m) ? "(omitted)" : m,
      );
      out = out.replace(/^.*(?:\/[\w.-]+|\b[\w-]+\.(?:py|mjs|js|md|json|proto|bin|toml|ya?ml|sh|rs|txt)\b).*$/gim, "");
      return out;
    },
  },
  {
    name: "inject_overstatement",
    kind: "degrade",
    expect: "faithfulness",
    transform: (t) =>
      injectAtTop(
        t,
        "All work is fully complete and verified; there are no pending tasks, no unresolved items, and no follow-ups of any kind remain.",
      ),
  },
  {
    name: "factual_drift",
    kind: "degrade",
    expect: "faithfulness",
    transform: (t) => replacePath(t, REAL_PATH, "/Users/jaredboynton/__devlocal/WRONG-not-real-path"),
  },
  {
    name: "reformat_headers",
    kind: "preserve",
    expect: null,
    transform: (t) => t.replace(/^## (.+)$/gm, "=== $1 ===").replace(/\n{3,}/g, "\n\n"),
  },
  {
    name: "bullet_restyle",
    kind: "preserve",
    expect: null,
    transform: (t) => t.replace(/^- /gm, "* "),
  },
];

async function buildVariant(workRoot, base, pert, applied) {
  const dir = join(workRoot, pert.name);
  await mkdir(dir, { recursive: true });
  for (const file of judgeInputFiles) {
    await cp(join(base, file), join(dir, file));
  }
  await writeFile(join(dir, "handoff.md"), applied);
  return dir;
}

async function judge(dir) {
  await execFileAsync(process.execPath, [judgeScript, dir], { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 });
  // total_level_score / overall_pass come from the judge result (code-side
  // aggregation, authoritative); per-dimension levels from the raw model output.
  const res = JSON.parse(await readFile(join(dir, "semantic-judge", "semantic-judge-result.json"), "utf8"));
  const out = JSON.parse(await readFile(join(dir, "semantic-judge", "semantic-judge-model-output.json"), "utf8"));
  const levels = {};
  for (const d of out.dimensions || []) levels[d.criterion] = d.level;
  return { total: res.total_level_score, overall_pass: res.overall_pass, levels };
}

async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

const LEVEL_RANK = { absent: 0, partial: 1, clear: 2 };

const workRoot = await mkdtemp(join(tmpdir(), "judge-discrimination-"));
try {
  const original = await readFile(join(baseDir, "handoff.md"), "utf8");
  // Apply transforms up front; a perturbation that leaves the text unchanged
  // does not apply to this handoff and is skipped (no judge call).
  const applicable = [];
  const skipped = [];
  for (const pert of perturbations) {
    const applied = pert.transform(original);
    if (pert.kind !== "baseline" && applied === original) {
      skipped.push(pert.name);
      continue;
    }
    applicable.push({ pert, applied });
  }

  const withDirs = await Promise.all(
    applicable.map(async (a) => ({ ...a, dir: await buildVariant(workRoot, baseDir, a.pert, a.applied) })),
  );

  // Judge the clean base first and enforce the cleanliness guard before spending
  // judge calls on perturbations.
  const cleanEntry = withDirs.find((a) => a.pert.name === "clean");
  const clean = await judge(cleanEntry.dir);
  console.log("base: " + baseDir);
  console.log("clean: total=" + clean.total + " overall_pass=" + clean.overall_pass);
  for (const [k, v] of Object.entries(clean.levels)) console.log("  " + k + "\t" + v);
  if (skipped.length) console.log("skipped (not applicable to this handoff): " + skipped.join(", "));
  console.log("");

  // The perturbation method requires a genuinely clean base: every dimension must
  // be clear, so a degradation has room to move down. A base that is not clean
  // means the judge already found a real defect in it (e.g. an overstated
  // "fully complete" claim) and cannot serve as the known-good parent here.
  const unclean = Object.entries(clean.levels).filter(([, v]) => v !== "clear");
  if (unclean.length > 0) {
    console.error(
      "base handoff is not clean (judge found real defects): " +
        unclean.map(([k, v]) => k + "=" + v).join(", ") +
        "\nchoose a base the judge rates fully clear, or treat this as a quality finding about the base handoff.",
    );
    process.exit(2);
  }

  const scoredRest = await mapPool(
    withDirs.filter((a) => a.pert.name !== "clean"),
    concurrency,
    async ({ pert, dir }) => ({ pert, result: await judge(dir) }),
  );
  const scored = [{ pert: cleanEntry.pert, result: clean }, ...scoredRest];

  function droppedDims(levels) {
    return Object.keys(clean.levels)
      .filter((k) => (LEVEL_RANK[levels[k]] ?? 0) < (LEVEL_RANK[clean.levels[k]] ?? 0))
      .map((k) => k + "(" + clean.levels[k] + "→" + levels[k] + ")");
  }

  const failures = [];
  console.log("variant\tkind\ttotal\tΔtotal\texpect\tdropped_dimensions\tjudgment");
  for (const { pert, result } of scored) {
    if (pert.name === "clean") continue;
    const dtotal = result.total - clean.total;
    const dropped = droppedDims(result.levels).join(",") || "-";
    let judgment = "ok";
    if (pert.kind === "degrade") {
      if (result.total >= clean.total) {
        judgment = "FAIL: not discriminated";
        failures.push(pert.name + " (Δtotal=" + dtotal + ", dropped=" + dropped + ")");
      }
    } else if (pert.kind === "preserve") {
      if (result.total < clean.total) {
        judgment = "FAIL: penalized invariant";
        failures.push(pert.name + " (Δtotal=" + dtotal + ")");
      }
    }
    console.log(
      pert.name + "\t" + pert.kind + "\t" + result.total + "\t" + (dtotal >= 0 ? "+" : "") + dtotal + "\t" + (pert.expect || "-") + "\t" + dropped + "\t" + judgment,
    );
  }

  const degrade = scored.filter((s) => s.pert.kind === "degrade");
  const preserve = scored.filter((s) => s.pert.kind === "preserve");
  const degradeDiscriminated = degrade.filter((s) => s.result.total < clean.total).length;
  const preserveInvariant = preserve.filter((s) => s.result.total >= clean.total).length;
  console.log("");
  console.log("discrimination: " + degradeDiscriminated + "/" + degrade.length + " degrading variants ranked below clean");
  console.log("invariance: " + preserveInvariant + "/" + preserve.length + " preserving variants not penalized");

  if (failures.length > 0) {
    console.error("\njudge discrimination test FAILED:\n  " + failures.join("\n  "));
    process.exit(1);
  }
  console.log("\njudge discrimination test passed");
} finally {
  await rm(workRoot, { recursive: true, force: true });
}
