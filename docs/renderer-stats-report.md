# Renderer Stats Report

Suggested path: `docs/renderer-stats-report.md`.

Generated: `2026-06-20T22:12:00.593Z`.

## Source

| Field | Value |
|---|---|
| Input | /Users/jaredboynton/__devlocal/claudecompact-patcher/transcripts/claude-main-session-81c06368-approx-595k-tokens.jsonl |
| Transcript SHA256 | 22894a749f51b3461c310f3b988d247f8da0affc7086ea4fa84a5d7645b6cf20 |
| Raw bytes | 2,379,590 |
| Logical records | 1066 |
| char/4 token estimate | 593,956 |

## Renderer Comparison

| Renderer | Records | Wrapped bytes | Wrapped char/4 tokens | Compressed records | Omitted chars | Omitted char/4 tokens |
|---|---|---|---|---|---|---|
| stripped | 1,066 | 565,633 | 140,921 | 0 | 0 | 0 |
| sentinel | 1,066 | 442,969 | 110,355 | 11 | 137,749 | 34,438 |
| jsonl | 1,066 | 2,412,636 | 602,218 | 0 | 0 | 0 |

## Record Types

Renderer used for detailed tables: `sentinel`.

| Type | Records | Raw bytes | Prompt chars | Rendered bytes | Max rendered line |
|---|---|---|---|---|---|
| assistant | 476 | 1,181,216 | 247,488 | 310,391 | 78 |
| user | 276 | 984,125 | 192,282 | 99,741 | 8 |
| attachment | 45 | 102,818 | 0 | 7,110 | 4 |
| permission-mode | 55 | 6,270 | 0 | 5,280 | 3 |
| last-prompt | 55 | 15,674 | 0 | 4,840 | 1 |
| ai-title | 54 | 6,912 | 0 | 4,428 | 15 |
| mode | 55 | 4,510 | 0 | 4,015 | 2 |
| file-history-snapshot | 35 | 69,279 | 0 | 3,780 | 7 |
| system | 11 | 6,899 | 22 | 1,617 | 86 |
| queue-operation | 4 | 821 | 243 | 701 | 568 |

## Roles

| Role | Records | Raw bytes | Prompt chars | Rendered bytes | Max rendered line |
|---|---|---|---|---|---|
| assistant | 476 | 1,181,216 | 247,488 | 310,391 | 78 |
| user | 276 | 984,125 | 192,282 | 99,741 | 8 |
| (none) | 314 | 213,183 | 265 | 31,771 | 568 |

## Derived Record Kinds

| Kind | Records | Raw bytes | Prompt chars | Rendered bytes | Max rendered line |
|---|---|---|---|---|---|
| tool_use | 264 | 486,485 | 201,164 | 231,491 | 78 |
| assistant_message | 211 | 689,441 | 46,324 | 78,712 | 114 |
| tool_output | 265 | 956,069 | 166,372 | 71,805 | 131 |
| metadata | 223 | 34,187 | 243 | 19,264 | 568 |
| user_message | 11 | 21,827 | 15,109 | 17,157 | 8 |
| compact_summary | 1 | 11,519 | 10,801 | 10,967 | 895 |
| attachment | 45 | 102,818 | 0 | 7,110 | 4 |
| file_history_snapshot | 35 | 69,279 | 0 | 3,780 | 7 |
| system | 11 | 6,899 | 22 | 1,617 | 86 |

## Content Block Types

| Block type | Records containing | Blocks | Raw chars | Prompt-visible chars | Max line |
|---|---|---|---|---|---|
| tool_use | 264 | 264 | 220,556 | 201,164 | 78 |
| tool_result | 264 | 264 | 198,377 | 166,372 | 38 |
| text | 102 | 102 | 49,121 | 46,324 | 114 |
| string_content | 15 | 15 | 26,175 | 26,175 | 8 |
| (no content block) | 266 | 266 | 0 | 0 |  |
| thinking | 108 | 108 | 378,148 | 0 |  |
| attachment:task_reminder | 23 | 23 | 1,173 | 0 |  |
| attachment:goal_status | 5 | 5 | 4,378 | 0 |  |
| attachment:file | 5 | 5 | 24,849 | 0 |  |
| attachment:hook_success | 2 | 2 | 2,026 | 0 |  |
| attachment:deferred_tools_delta | 2 | 2 | 30,801 | 0 |  |
| attachment:agent_listing_delta | 2 | 2 | 4,320 | 0 |  |
| attachment:skill_listing | 2 | 2 | 17,425 | 0 |  |
| attachment:queued_command | 2 | 2 | 441 | 0 |  |
| attachment:hook_additional_context | 1 | 1 | 453 | 0 |  |
| server_tool_use | 1 | 1 | 95 | 0 |  |
| advisor_tool_result | 1 | 1 | 3,560 | 0 |  |
| attachment:edited_text_file | 1 | 1 | 429 | 0 |  |

## Record Type x Block Type

| Record / block | Blocks | Raw chars | Prompt-visible chars | Max line |
|---|---|---|---|---|
| assistant / tool_use | 264 | 220,556 | 201,164 | 78 |
| user / tool_result | 264 | 198,377 | 166,372 | 38 |
| assistant / text | 102 | 49,121 | 46,324 | 114 |
| user / string_content | 12 | 25,910 | 25,910 | 8 |
| queue-operation / string_content | 2 | 243 | 243 | 568 |
| system / string_content | 1 | 22 | 22 | 894 |
| last-prompt / (no content block) | 55 | 0 | 0 |  |
| mode / (no content block) | 55 | 0 | 0 |  |
| permission-mode / (no content block) | 55 | 0 | 0 |  |
| ai-title / (no content block) | 54 | 0 | 0 |  |
| file-history-snapshot / (no content block) | 35 | 0 | 0 |  |
| system / (no content block) | 10 | 0 | 0 |  |
| queue-operation / (no content block) | 2 | 0 | 0 |  |
| attachment / attachment:hook_success | 2 | 2,026 | 0 |  |
| attachment / attachment:hook_additional_context | 1 | 453 | 0 |  |
| attachment / attachment:deferred_tools_delta | 2 | 30,801 | 0 |  |
| attachment / attachment:agent_listing_delta | 2 | 4,320 | 0 |  |
| attachment / attachment:skill_listing | 2 | 17,425 | 0 |  |
| assistant / thinking | 108 | 378,148 | 0 |  |
| attachment / attachment:task_reminder | 23 | 1,173 | 0 |  |
| assistant / server_tool_use | 1 | 95 | 0 |  |
| assistant / advisor_tool_result | 1 | 3,560 | 0 |  |
| attachment / attachment:goal_status | 5 | 4,378 | 0 |  |
| attachment / attachment:queued_command | 2 | 441 | 0 |  |
| attachment / attachment:edited_text_file | 1 | 429 | 0 |  |
| attachment / attachment:file | 5 | 24,849 | 0 |  |

## Sentinel Compression

| Metric | Value |
|---|---|
| Compressed tool-output records | 11 |
| Original compressed body chars | 153,149 |
| Rendered compressed body chars | 43,111 |
| Omitted chars | 137,749 |
| Omitted char/4 tokens | 34,438 |

### Largest Omitted Tool Outputs

| Line | Type | Role | Omitted chars | Original chars | Hash | Preview |
|---|---|---|---|---|---|---|
| 38 | user | user | 21,908 | 23,308 | a4108f075e60 | type=user \| uuid=60a7fccd-d0bf-4938-ba67-bb5c2b575d43 \| role=user |
| 36 | user | user | 21,080 | 22,480 | 41abdce7bdf7 | type=user \| uuid=578d5a45-839b-4087-82ea-aebc80ba40d1 \| role=user |
| 59 | user | user | 20,379 | 21,779 | 29ad33ec066b | type=user \| uuid=6e95651f-71b3-47dc-9aab-734e3fc91651 \| role=user |
| 52 | user | user | 14,382 | 15,782 | 789ce9010d46 | type=user \| uuid=5bd4ce75-3260-4e68-9c5e-3e20a89af4da \| role=user |
| 93 | user | user | 14,110 | 15,510 | da013924a6fb | type=user \| uuid=a8e18191-c103-4119-a089-336016c1e6d6 \| role=user |
| 146 | user | user | 12,912 | 14,312 | 27d614651f42 | type=user \| uuid=259d57bc-6cbf-49ce-93f5-513deaaa603c \| role=user |
| 122 | user | user | 11,637 | 13,037 | 14f4276503fd | type=user \| uuid=91278297-48fe-4b7b-8038-fc4522fa9685 \| role=user |
| 141 | user | user | 10,664 | 12,064 | 71e1c14e20a5 | type=user \| uuid=90410a13-dafd-4e8b-aa1a-e9c664b1502a \| role=user |
| 54 | user | user | 5,316 | 6,716 | aaa146233763 | type=user \| uuid=065d96e2-2d79-4b09-bdfa-4366dc6ac2d4 \| role=user |
| 139 | user | user | 4,182 | 5,582 | 9825fd6a9610 | type=user \| uuid=b7d66db3-39eb-41da-ac41-4923e051a73c \| role=user |
| 99 | user | user | 1,179 | 2,579 | bb18cb4ffb35 | type=user \| uuid=a59640d7-4692-497d-b85e-57af83c5566a \| role=user |

## Largest Rendered Records

| Line | Type | Role | Kind | Rendered bytes | Raw bytes | Hash | Preview |
|---|---|---|---|---|---|---|---|
| 78 | assistant | assistant | tool_use | 15,670 | 16,919 | 334117846d68 | type=assistant \| uuid=573d5ed1-8a78-4eb2-854a-aec1b319986f \| role=assistant |
| 1050 | assistant | assistant | tool_use | 14,145 | 15,063 | 18d1d779657f | type=assistant \| uuid=d369f802-9ee8-4534-bf1b-f299041d1834 \| role=assistant |
| 8 | user | user | user_message | 12,480 | 13,190 | 1c85afbd8c21 | type=user \| uuid=c196e663-101d-4e3d-af3e-ea77e2dccfc4 \| role=user \| text=continue this exploratoin: ``` codex ╭───────────────────────────── |
| 895 | user | user | compact_summary | 10,967 | 11,519 | cc2d8f0c9710 | type=user \| uuid=9df6a930-2087-4d5c-a793-33c3f578112b \| role=user \| text=This session is being continued from a previous conversation that r |
| 235 | assistant | assistant | tool_use | 6,986 | 8,226 | ded7df3be99c | type=assistant \| uuid=9bbf5bc0-4c34-402d-93e8-43288b48f1fa \| role=assistant |
| 313 | assistant | assistant | tool_use | 6,479 | 7,719 | 1b710a90e85c | type=assistant \| uuid=5b56f6ad-aa7b-427e-a1d3-dbdb30b5f7b4 \| role=assistant |
| 728 | assistant | assistant | tool_use | 6,233 | 7,396 | 6d270db00d26 | type=assistant \| uuid=eae4b3a7-c357-4854-bab5-807eb6b23460 \| role=assistant |
| 601 | assistant | assistant | tool_use | 6,215 | 7,378 | 6f7d52e99449 | type=assistant \| uuid=6366b713-0c46-4290-9ff4-8faff0558a90 \| role=assistant |
| 319 | assistant | assistant | tool_use | 5,347 | 6,587 | 56382e5881a3 | type=assistant \| uuid=cf8173c4-95d0-489c-900f-9aa9e0e0654d \| role=assistant |
| 1025 | assistant | assistant | tool_use | 5,151 | 6,346 | 0589fac750a6 | type=assistant \| uuid=1c066bd3-6be8-4985-9769-c3aa52df76f3 \| role=assistant |
| 752 | assistant | assistant | tool_use | 4,843 | 6,006 | 4957835b37bb | type=assistant \| uuid=9f517a5f-f601-42c4-8fa3-6d65a42d5659 \| role=assistant |
| 695 | assistant | assistant | tool_use | 4,836 | 6,003 | 808f24b08297 | type=assistant \| uuid=eea92ccd-0830-4af4-8e47-9d3df8cfab7e \| role=assistant |
| 504 | assistant | assistant | tool_use | 4,697 | 5,860 | 30348063a5c0 | type=assistant \| uuid=01e651b1-56a8-46dd-8e6f-c528ec3a50cd \| role=assistant |
| 420 | assistant | assistant | tool_use | 4,664 | 5,904 | 69ea1243f9ad | type=assistant \| uuid=51cf327e-4b25-4a9d-8000-61723c836df2 \| role=assistant |
| 272 | assistant | assistant | tool_use | 4,462 | 5,702 | 4aa9a12b91c5 | type=assistant \| uuid=376abdf0-a544-4685-a86b-3706be8c88e5 \| role=assistant |

## Largest Raw Records

| Line | Type | Role | Kind | Raw bytes | Rendered bytes | Hash | Preview |
|---|---|---|---|---|---|---|---|
| 38 | user | user | tool_output | 48,094 | 1,745 | a4108f075e60 | type=user \| uuid=60a7fccd-d0bf-4938-ba67-bb5c2b575d43 \| role=user |
| 36 | user | user | tool_output | 46,834 | 1,739 | 41abdce7bdf7 | type=user \| uuid=578d5a45-839b-4087-82ea-aebc80ba40d1 \| role=user |
| 59 | user | user | tool_output | 44,824 | 1,742 | 29ad33ec066b | type=user \| uuid=6e95651f-71b3-47dc-9aab-734e3fc91651 \| role=user |
| 52 | user | user | tool_output | 32,916 | 1,741 | 789ce9010d46 | type=user \| uuid=5bd4ce75-3260-4e68-9c5e-3e20a89af4da \| role=user |
| 93 | user | user | tool_output | 32,270 | 1,739 | da013924a6fb | type=user \| uuid=a8e18191-c103-4119-a089-336016c1e6d6 \| role=user |
| 916 | user | user | tool_output | 30,900 | 168 | da5aed4829ca | type=user \| uuid=b21f7a1d-cde3-4c9c-8acf-b4f2420e395a \| role=user |
| 146 | user | user | tool_output | 30,056 | 1,744 | 27d614651f42 | type=user \| uuid=259d57bc-6cbf-49ce-93f5-513deaaa603c \| role=user |
| 122 | user | user | tool_output | 27,210 | 1,740 | 14f4276503fd | type=user \| uuid=91278297-48fe-4b7b-8038-fc4522fa9685 \| role=user |
| 141 | user | user | tool_output | 25,673 | 1,746 | 71e1c14e20a5 | type=user \| uuid=90410a13-dafd-4e8b-aa1a-e9c664b1502a \| role=user |
| 150 | user | user | tool_output | 21,564 | 168 | c2dab324d63d | type=user \| uuid=973cb7a2-3fb6-4600-b802-3dbfbf1cacb4 \| role=user |
| 21 | user | user | tool_output | 21,330 | 168 | d7ca5dd3626a | type=user \| uuid=a8ae35ad-9f2c-4292-b66b-8cec7a577f8c \| role=user |
| 11 | attachment | (none) | attachment | 17,157 | 158 | 3f02cdcf3816 | type=attachment \| uuid=9bc73acf-358a-4200-8c5f-c9b1fd70dfda |
| 619 | assistant | assistant | assistant_message | 17,092 | 188 | dace09d97070 | type=assistant \| uuid=09006e71-8c8c-4fbf-8226-1d22992d29bf \| role=assistant |
| 78 | assistant | assistant | tool_use | 16,919 | 15,670 | 334117846d68 | type=assistant \| uuid=573d5ed1-8a78-4eb2-854a-aec1b319986f \| role=assistant |
| 79 | user | user | tool_output | 16,360 | 263 | ad0b32c6f72e | type=user \| uuid=e1764792-a4b7-488a-9107-c9de502589df \| role=user |

## Notes

- `Prompt-visible chars` uses the same local text extraction path as the renderer.
- `thinking` blocks in this transcript are mostly empty prompt-visible text with raw signature metadata.
- `char/4` token counts are estimates, not provider tokenizer measurements.
- This report is generated locally and does not call any model provider.
