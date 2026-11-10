---
name: code-review
description: Review a proposed code change for actionable correctness issues and regressions.
---

# Example code-review skill

This is generic starter content. Customize it for your team's conventions before
adopting it as team policy.

1. Read the requested change, applicable repository instructions, and surrounding
   callers before drawing conclusions. Establish the intended behavior.
2. Look for concrete correctness failures, regressions, lost data, and unsafe
   handling of inputs. Trace each suspected issue through an actual execution path.
3. Check whether existing tests exercise the changed behavior. Run relevant checks
   when available; distinguish executed checks from suggested checks.
4. Report actionable findings with the affected file and line, the trigger, the
   consequence, and a concise explanation. Prioritize by impact and confidence.
5. Do not invent issues to fill a quota. Separate unresolved questions from proven
   defects. If no actionable findings remain, say so and state verification limits.

Reviewing does not authorize changing files or publishing the change.
