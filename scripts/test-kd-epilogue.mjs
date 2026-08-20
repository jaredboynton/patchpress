#!/usr/bin/env node
// Unit tests for _kd success-tail extraction. These do NOT need a Claude binary:
// they feed locateKd / extractKdEpilogue synthetic function bodies that match
// the shapes seen in 2.1.x (and a few future-drift variants) and assert the
// redirect splices the native prelude + wrap call instead of reconstructing
// a hardcoded preamble/replnote signature.
import { locateKd, extractKdEpilogue, padRedirect } from "./patcher/patch-claude.mjs";

function assert(cond, label) {
  if (!cond) throw new Error("FAIL: " + label);
}

function fakeKd({ prelude, wrapCall, ok = "!0", extraBefore = "" }) {
  return (
    `async function FakeKd(e,t,r,n){` +
    extraBefore +
    `const q={querySource:"compact",forkLabel:"reactive-compact"};` +
    `${prelude};` +
    `return{ok:${ok},summaryText:l,forkAssistantMessageCount:cnt(s.messages),totalUsage:s.totalUsage,messages:[${wrapCall}]}}`
  );
}

const fixtures = [
  {
    name: "legacy-positional+getReplContexts",
    prelude: "let c=qf(),u=ox()&&MPt(t.toolUseContext.getReplContexts(),t.toolUseContext.agentId)",
    wrapCall: "UOt({content:zLt(l,!0,c,void 0,u),isCompactSummary:!0,isVisibleInTranscriptOnly:!0})",
    expect: {
      wrap: "UOt",
      preamble: "zLt",
      live: "qf",
      replnote: "MPt",
      replArg: "getReplContexts()",
      isObjectPreamble: false,
    },
  },
  {
    name: "2.1.224-object+getReplContexts",
    prelude: "let c=qb(),u=O$()&&Qrn(t.toolUseContext.getReplContexts(),t.toolUseContext.agentId)",
    wrapCall: "nn({content:r_n(l,{suppressFollowUpQuestions:!0,transcriptPath:c,replStateCleared:u}),isCompactSummary:!0,isVisibleInTranscriptOnly:!0})",
    expect: {
      wrap: "nn",
      preamble: "r_n",
      live: "qb",
      replnote: "Qrn",
      replArg: "getReplContexts()",
      isObjectPreamble: true,
    },
  },
  {
    name: "2.1.237-object+toolState",
    prelude: "let c=pv(),u=JB()&&xFn(t.toolUseContext.toolState,t.toolUseContext.agentId)",
    wrapCall: "Sn({content:Q6n(l,{suppressFollowUpQuestions:!0,transcriptPath:c,replStateCleared:u}),isCompactSummary:!0,isVisibleInTranscriptOnly:!0})",
    expect: {
      wrap: "Sn",
      preamble: "Q6n",
      live: "pv",
      replnote: "xFn",
      replArg: "toolState",
      isObjectPreamble: true,
    },
  },
  {
    name: "future-extra-preamble-key+wrap-field",
    prelude: "let c=pv(),u=JB()&&xFn(t.toolUseContext.toolState,t.toolUseContext.agentId)",
    wrapCall: "Sn({content:Q6n(l,{suppressFollowUpQuestions:!0,transcriptPath:c,replStateCleared:u,sessionId:z}),isCompactSummary:!0,isVisibleInTranscriptOnly:!0,isMeta:!0})",
    expect: {
      wrap: "Sn",
      preamble: "Q6n",
      replArg: "toolState",
      isObjectPreamble: true,
      keep: ["sessionId:z", "isMeta:!0"],
    },
  },
  {
    name: "future-extra-prelude-binding+live-args+ok:true",
    prelude: "let c=pv(t),u=JB()&&xFn(t.toolUseContext.toolState,t.toolUseContext.agentId),z=NEW()",
    wrapCall: "Sn({content:Q6n(l,{suppressFollowUpQuestions:!0,transcriptPath:c,replStateCleared:u}),isCompactSummary:!0,isVisibleInTranscriptOnly:!0})",
    ok: "true",
    expect: {
      wrap: "Sn",
      preamble: "Q6n",
      live: "pv",
      replArg: "toolState",
      keep: ["pv(t)", "z=NEW()"],
    },
  },
];

let passed = 0;
for (const fx of fixtures) {
  const src = fakeKd(fx);
  const extracted = extractKdEpilogue(src.slice(src.indexOf("{") + 1, src.lastIndexOf("}")));
  assert(extracted.wrap === fx.expect.wrap, `${fx.name}: wrap=${extracted.wrap}`);
  assert(extracted.preamble === fx.expect.preamble, `${fx.name}: preamble=${extracted.preamble}`);
  if (fx.expect.live) assert(extracted.live === fx.expect.live, `${fx.name}: live=${extracted.live}`);
  if (fx.expect.replnote) assert(extracted.replnote === fx.expect.replnote, `${fx.name}: replnote=${extracted.replnote}`);
  if (fx.expect.replArg) assert(extracted.replArg === fx.expect.replArg, `${fx.name}: replArg=${extracted.replArg}`);
  if (fx.expect.isObjectPreamble !== undefined) {
    assert(extracted.isObjectPreamble === fx.expect.isObjectPreamble, `${fx.name}: isObjectPreamble`);
  }

  const kd = locateKd(src);
  assert(kd && kd.redirectCode, `${fx.name}: locateKd resolved`);
  assert(kd.redirectCode.includes(fx.prelude), `${fx.name}: redirect keeps native prelude`);
  assert(kd.redirectCode.includes(`content:${fx.expect.preamble}(rawHandoff`), `${fx.name}: splices rawHandoff`);
  assert(!kd.redirectCode.includes(`content:${fx.expect.preamble}(l`), `${fx.name}: did not leave native summary var`);
  assert(!kd.redirectCode.includes("getReplContexts()") || fx.prelude.includes("getReplContexts()"), `${fx.name}: did not hardcode getReplContexts`);
  assert(!kd.redirectCode.includes(",!0,c,void 0,u)") || fx.wrapCall.includes(",!0,c,void 0,u)"), `${fx.name}: did not hardcode positional preamble`);
  for (const token of fx.expect.keep || []) {
    assert(kd.redirectCode.includes(token), `${fx.name}: preserved native token ${token}`);
  }
  const padded = padRedirect(kd.redirectCode, Math.max(kd.bodyByteLength, kd.redirectCode.length + 16), kd.label);
  assert(padded.paddedBuf.length >= Buffer.from(kd.redirectCode, "utf8").length, `${fx.name}: padRedirect accepts spliced redirect`);
  console.log(`OK ${fx.name}: wrap=${extracted.wrap} preamble=${extracted.preamble} replArg=${extracted.replArg || "-"}`);
  passed += 1;
}

// Fail-closed: no success return -> throw, never a reconstructed fallback.
let threw = false;
try {
  extractKdEpilogue('async function x(e,t,r,n){const q={querySource:"compact",forkLabel:"reactive-compact"};return{ok:!1,reason:"error"}}');
} catch (e) {
  threw = /success-return/.test(e.message);
}
assert(threw, "missing success-return fails closed");
console.log("OK fail-closed when success-return is absent");

console.log(`\n_kd epilogue splice test passed (${passed} fixtures).`);
