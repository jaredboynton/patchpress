// Canonical benchmark lane registry. Run dirs live under runs/bench-<runDir>.

export const SINGLE_SHOT_LANES = [
  { laneId: "codex-sentinel", runDir: "bench-codex-sentinel", modelLabel: "`gpt-5.4` (codex)", renderer: "sentinel" },
  { laneId: "codex-stripped", runDir: "bench-codex-stripped", modelLabel: "`gpt-5.4` (codex)", renderer: "stripped" },
  { laneId: "codex-onto", runDir: "bench-codex-onto", modelLabel: "`gpt-5.4` (codex)", renderer: "onto" },
  { laneId: "codex55-sentinel", runDir: "bench-codex55-sentinel", modelLabel: "`gpt-5.5` (codex)", renderer: "sentinel" },
  { laneId: "codex55-stripped", runDir: "bench-codex55-stripped", modelLabel: "`gpt-5.5` (codex)", renderer: "stripped" },
  { laneId: "codex55-onto", runDir: "bench-codex55-onto", modelLabel: "`gpt-5.5` (codex)", renderer: "onto" },
  {
    laneId: "g35flash-sentinel",
    runDir: "bench-g35flash-sentinel",
    modelLabel: "`gemini-3.5-flash`",
    renderer: "sentinel",
  },
  {
    laneId: "g35flash-stripped",
    runDir: "bench-g35flash-stripped",
    modelLabel: "`gemini-3.5-flash`",
    renderer: "stripped",
  },
  {
    laneId: "g35flash-onto",
    runDir: "bench-gemini35flash-onto",
    modelLabel: "`gemini-3.5-flash`",
    renderer: "onto",
  },
  {
    laneId: "xai-sentinel",
    runDir: "bench-xai-sentinel",
    modelLabel: "`grok-4.20` (xAI)",
    renderer: "sentinel",
  },
  {
    laneId: "xai-stripped",
    runDir: "bench-xai-stripped",
    modelLabel: "`grok-4.20` (xAI)",
    renderer: "stripped",
  },
  {
    laneId: "grok420-onto",
    runDir: "bench-grok420-onto",
    modelLabel: "`grok-4.20` (xAI)",
    renderer: "onto",
  },
  {
    laneId: "g31lite-sentinel",
    runDir: "bench-g31lite-t04-min-sentinel",
    modelLabel: "`gemini-3.1-flash-lite`",
    renderer: "sentinel",
  },
  {
    laneId: "g31lite-stripped",
    runDir: "bench-g31lite-t04-min-stripped",
    modelLabel: "`gemini-3.1-flash-lite`",
    renderer: "stripped",
  },
  {
    laneId: "g31lite-onto",
    runDir: "bench-gemini-flashlite-onto",
    modelLabel: "`gemini-3.1-flash-lite`",
    renderer: "onto",
  },
  {
    laneId: "mantle-sentinel",
    runDir: "bench-mantle-sentinel",
    modelLabel: "`xai.grok-4.3` (Mantle)",
    renderer: "sentinel",
  },
  {
    laneId: "mantle-stripped",
    runDir: "bench-mantle-stripped",
    modelLabel: "`xai.grok-4.3` (Mantle)",
    renderer: "stripped",
  },
  {
    laneId: "grok43-onto",
    runDir: "bench-grok43-onto",
    modelLabel: "`xai.grok-4.3` (Mantle)",
    renderer: "onto",
  },
];

export const UNTIL_PASS_LANES = [
  {
    laneId: "g35flash-onto-until-pass",
    runDir: "bench-g35flash-onto-until-pass",
    modelLabel: "`gemini-3.5-flash`",
    renderer: "onto",
  },
  {
    laneId: "grok420-onto-until-pass",
    runDir: "bench-grok420-onto-until-pass",
    modelLabel: "`grok-4.20` (xAI)",
    renderer: "onto",
  },
  {
    laneId: "grok43-onto-until-pass",
    runDir: "bench-grok43-onto-until-pass",
    modelLabel: "`xai.grok-4.3` (Mantle)",
    renderer: "onto",
  },
  {
    laneId: "grok43-sentinel-until-pass",
    runDir: "bench-mantle-sentinel-until-pass",
    modelLabel: "`xai.grok-4.3` (Mantle)",
    renderer: "sentinel",
  },
  {
    laneId: "g31lite-stripped-until-pass",
    runDir: "bench-g31lite-stripped-until-pass",
    modelLabel: "`gemini-3.1-flash-lite`",
    renderer: "stripped",
  },
];

export function lanesForSuite(suite) {
  if (suite === "single-shot") return SINGLE_SHOT_LANES;
  if (suite === "until-pass") return UNTIL_PASS_LANES;
  if (suite === "all") return [...SINGLE_SHOT_LANES, ...UNTIL_PASS_LANES];
  throw new Error("Expected --suite single-shot, until-pass, or all");
}
