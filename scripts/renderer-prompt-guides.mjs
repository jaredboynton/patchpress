// Renderer-specific "how to read" / "how to output" guides for the compaction prompt.
// Format-only mini-examples (not a full handoff few-shot); spliced for every provider.

const SHARED_OUTPUT_TAIL = [
  "Use source_spans like the fragments above:",
  "- cite exact citable record numbers as bare integers, never zero-padded strings;",
  "- prefer narrow spans for distinct claims;",
  "- keep section names natural and unnumbered;",
  "- do not copy these example domains into the handoff.",
  "Line numbers in source_spans are bare integers (42), never zero-padded strings.",
];

const GUIDES = {
  sentinel: {
    read: [
      "How to read (sentinel renderer):",
      "Each citable record is a sentinel block. The record number is the integer after line=",
      "on the opening @@RECORD line (zero-padded there only for alignment).",
      "",
      "  @@RECORD line=000042 type=user role=user ts=2026-06-20T12:00:00.000Z chars=52",
      "  Add transport capture notes here.",
      "  @@END_RECORD line=000042",
      "",
      "  @@RECORD line=000180 type=assistant role=assistant ts=... chars=2400",
      "  [tool output compressed: strategy=headtail ... line=180 ...]",
      "  ...compressed body...",
      "  @@END_RECORD line=000180",
      "",
      "Cite start_line/end_line 42 and 180 (integers). Ignore @@END_RECORD for numbering.",
      "Compressed tool bodies still cite the @@RECORD line= number shown in the marker.",
    ],
    output: [
      "How to output (sentinel renderer): anchor with source_spans on the @@RECORD line numbers.",
      "",
      '  "summary_blocks": [',
      '    {',
      '      "section": "Current live state",',
      '      "format": "bullet",',
      '      "body": "Short continuation fact grounded in the cited record.",',
      '      "source_spans": [',
      '        {"start_line": 42, "end_line": 42},',
      '        {"start_line": 180, "end_line": 180}',
      "      ]",
      "    }",
      "  ],",
      '  "plans_and_task_state": [',
      "    {",
      '      "item": "Immediate next action from the latest state.",',
      '      "status": "pending",',
      '      "source_spans": [{"start_line": 180, "end_line": 180}]',
      "    }",
      "  ]",
    ],
  },
  stripped: {
    read: [
      "How to read (stripped renderer):",
      "Each citable record is wrapped in <record line=\"NNNNNN\" ...>. The record number is",
      "the integer inside the line=\"\" attribute (zero-padded in the tag only).",
      "",
      '  <record line="000042" type="user" role="user" timestamp="2026-06-20T12:00:00.000Z">',
      "  Add transport capture notes here.",
      "  </record>",
      "",
      '  <record line="000180" type="user" role="user" timestamp="...">',
      "  Body may include compressed tool output with an explicit line= marker.",
      "  </record>",
      "",
      "Cite start_line/end_line 42 and 180 (integers). Use the line= attribute value, not XML tags.",
    ],
    output: [
      "How to output (stripped renderer): anchor with source_spans on the line= attribute values.",
      "",
      '  "summary_blocks": [',
      '    {',
      '      "section": "Current live state",',
      '      "format": "bullet",',
      '      "body": "Short continuation fact grounded in the cited record.",',
      '      "source_spans": [',
      '        {"start_line": 42, "end_line": 42},',
      '        {"start_line": 180, "end_line": 180}',
      "      ]",
      "    }",
      "  ],",
      '  "plans_and_task_state": [',
      "    {",
      '      "item": "Immediate next action from the latest state.",',
      '      "status": "pending",',
      '      "source_spans": [{"start_line": 180, "end_line": 180}]',
      "    }",
      "  ]",
    ],
  },
  onto: {
    read: [
      "How to read (onto renderer):",
      "Line 1 is the schema-once header. Each record is one pipe metadata row then body lines",
      "until the next row matching ^N+| . The record number is the first pipe field (integer).",
      "",
      "  @@ONTO Transcript[799] fields=line|type",
      "  42|user",
      "  Add transport capture notes here.",
      "  180|assistant",
      "  [tool output compressed: strategy=headtail ... line=180 ...]",
      "  ...compressed body...",
      "",
      "Cite start_line/end_line 42 and 180 (integers). Body lines starting with space+N|",
      "are escaped content, not new records.",
    ],
    output: [
      "How to output (onto renderer): anchor with source_spans on the first pipe field (line column).",
      "These examples demonstrate JSON shape only. Do not copy their section names or body text.",
      "",
      '  "summary_blocks": [',
      '    { "section": "Current live state", "format": "bullet",',
      '      "body": "Short continuation fact grounded in the cited record.",',
      '      "source_spans": [{"start_line": 42, "end_line": 42}, {"start_line": 180, "end_line": 180}] }',
      "  ],",
      '  "plans_and_task_state": [',
      '    { "item": "Immediate next action from the latest state.", "status": "pending",',
      '      "source_spans": [{"start_line": 180, "end_line": 180}] }',
      "  ]",
    ],
  },
};

export function rendererTranscriptGuide(renderer) {
  const key = renderer === "sentinel" || renderer === "onto" ? renderer : "stripped";
  const guide = GUIDES[key];
  const rules =
    key === "sentinel"
      ? [
          "- The transcript is wrapped as sentinel records beginning with @@RECORD line=000001 ... and ending with @@END_RECORD line=000001.",
          "- Use one-based logical JSONL record numbers from the @@RECORD line for every source span.",
          "- Some older tool-output records may be body-compressed with an explicit sha256 marker; cite the record line when that compressed output matters, because the harness rehydrates exact content from the source JSONL.",
        ]
      : key === "onto"
        ? [
            "- The transcript uses ONTO-inspired schema-once row-major framing: the first line '@@ONTO Transcript[N] fields=line|type' declares the per-record metadata keys once.",
            "- Each record then starts with one pipe-delimited value row 'line|type', immediately followed by that record's body until the next row.",
            "- Use the first pipe field (the one-based logical JSONL record number) from each row for every source span.",
            "- Some older tool-output records may be body-compressed with an explicit sha256 marker; cite the record line when that compressed output matters, because the harness rehydrates exact content from the source JSONL.",
          ]
        : [
            '- The transcript is wrapped as <record line="000001">...</record>.',
            "- Use one-based logical JSONL record numbers from those wrappers for every source span.",
          ];
  return [
    ...rules,
    "",
    ...guide.read,
    "",
    ...guide.output,
    "",
    ...SHARED_OUTPUT_TAIL,
  ];
}
