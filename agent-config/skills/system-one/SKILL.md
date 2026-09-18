---
name: system-one
description: Use TypeSafe Jev (System One) for fast, calibrated semantic decisions in classical software, data pipelines, and agent harnesses via OpenRouter or TypeSafe direct.
---

# System One: TypeSafe Jev Decision Engine

System One models (TypeSafe Jev) provide reflexive, non-generative semantic evaluation. Instead of generating conversational text token-by-token, Jev ingests an unstructured state block and evaluates multiple typed questions in a single parallel forward pass.

```
State (diff, text, records, AST) ──► Jev Parallel Sampler (120ms) ──► Typed Probabilities ──► Deterministic Logic
                                                                           │ (P + Confidence)
                                                                           └──► Gate / Alert / Route
```

Use Jev when software needs to interpret meaning, evaluate constraints, classify intent, or score quality with low latency and low cost, without the latency, price, or formatting uncertainty of autoregressive LLM generation.

---

## The Model & Routing

* **Model Slug**: `typesafe/jev-1.13` (alias: `~typesafe/jev-latest`)
* **Endpoint (OpenRouter)**: `POST https://openrouter.ai/api/alpha/decisions`
* **Endpoint (TypeSafe Direct)**: `POST https://api.typesafe.ai/v1/systemone`
* **Modality**: `text -> decisions` (zero string output)
* **Economics**: $\$0.042\text{ per million input tokens}$ ($\$0\text{ completion}$)
* **Context Limit**: $32,000\text{ tokens}$ total context ($24,000\text{ characters}$ recommended ceiling per request)
* **Latency**: $70–450\text{ ms}$ typical end-to-end

---

## Core Primitives

Jev returns three typed output primitives. Every question requires `type` and `instructions`:

| Primitive | Declaration Shape | Output Shape | When to Use |
| :--- | :--- | :--- | :--- |
| **Noul** | `criteria?: { true?: string, false?: string }` | `{ type: "noul", noul: number }`<br>Single float $P \in [0.0, 1.0]$ | Binary assertions, predicate checks, boolean gates (`is_bug`, `credential_leak`). |
| **Choice** | `criteria: Record<string, string \| null>`<br>(map of option to rubric) | `{ type: "choice", choice: string, probabilities: Record<string, number>, confidence: number }` | Categorical routing, selection among valid candidates ($\le 255$ options). |
| **Score** | `criteria: string[]`<br>(ordered array of $\ge 2$ level descriptions) | `{ type: "score", score: number, legend: Record<string, string>, probabilities: Record<string, number>, confidence: number }` | Ordinal ratings, quality tiers, risk scores (returns expectation across levels). |

---

## 1. Classical Software Integration (Non-Agentic)

When building standard web services, CLI tools, ETL pipelines, or background workers, invoke Jev directly using zero-dependency HTTP calls. Do not couple non-agent projects to harness internals.

### TypeScript / Node / Bun / Cloudflare Workers
```typescript
interface DecisionResponse {
  model: string;
  answers: Record<string, {
    type: "noul" | "choice" | "score";
    noul?: number;
    choice?: string;
    score?: number;
    probabilities?: Record<string, number>;
    confidence?: number;
  }>;
}

export async function askJev(
  state: string,
  questions: Record<string, unknown>,
  apiKey = process.env.OPENROUTER_API_KEY
): Promise<DecisionResponse> {
  const res = await fetch("https://openrouter.ai/api/alpha/decisions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": "https://myapp.internal",
      "X-Title": "MyApp Triage",
    },
    body: JSON.stringify({
      model: "typesafe/jev-1.13",
      state: state.slice(0, 24000), // Bound state to protect context
      questions,
    }),
  });

  if (!res.ok) throw new Error(`Jev error ${res.status}: ${await res.text()}`);
  return res.json();
}
```

### Python (FastAPI, Flask, Celery, CLI)
```python
import os, json, urllib.request

def ask_jev(state: str, questions: dict, api_key: str = None) -> dict:
    key = api_key or os.environ.get("OPENROUTER_API_KEY")
    req = urllib.request.Request(
        "https://openrouter.ai/api/alpha/decisions",
        data=json.dumps({
            "model": "typesafe/jev-1.13",
            "state": state[:24000],
            "questions": questions,
        }).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "https://myapp.internal",
            "X-Title": "MyApp",
        },
        method="POST"
    )
    with urllib.request.urlopen(req, timeout=10.0) as resp:
        return json.loads(resp.read().decode("utf-8"))
```

---

## 2. Classical Software Patterns

### Pattern A: Relationalizing Unstructured Streams (SQLite / Postgres)
Convert messy prose into structured, B-tree indexable relational columns on ingest:

```sql
-- In SQLite / Postgres ingestion pipelines:
INSERT INTO tickets (id, body, category, is_urgent)
VALUES (
  $1, $2,
  jev_choice($2, 'billing', 'technical', 'sales', 'other'),
  jev_noul($2, 'Customer states service is completely down')
);
-- Instant SQL filtering with zero vector search overhead:
SELECT * FROM tickets WHERE category = 'technical' AND is_urgent = 1;
```

### Pattern B: Candidate Selection Replacing Open-Ended Generation
Instead of asking an LLM to generate code or text from scratch (slow, expensive, syntax risk), use deterministic code to generate 3–5 valid options, and Jev to pick the cleanest one:

```python
# 1. Deterministic code generates valid AST import diffs
candidates = generate_possible_import_fixes(unresolved_symbol)
# 2. Jev selects the semantically appropriate option in 120ms
decision = ask_jev(file_context, {
    "fix": {
        "type": "choice",
        "instructions": "Which candidate fix resolves the missing import with least incidental churn?",
        "criteria": {c["id"]: c["description"] for c in candidates}
    }
})
apply_patch(candidates[decision["answers"]["fix"]["choice"]])
```

---

## 3. Agent Harness Integration (OMP, Pi, Hermes)

In agent harnesses, System One functions as an **out-of-band supervisory reflex**:

### The Atomic Question Paradigm
Do not write bespoke scripts for every check. Define atomic questions once, tag them by tap point, and filter dynamically:

```typescript
// Shared Question Definition
export const POKAYOKE_QUESTION: Question = {
  type: "choice",
  instructions: "What is the mechanism of this change? Pick the primary category.",
  criteria: {
    structural_type_or_shape: "Eliminates failure class structurally via types or shape",
    fail_closed_check: "Enforces strict fail-closed boundary validation",
    suppressed_symptom: "Silences error or catches and ignores exception",
    warning_or_comment: "Adds an instruction or log instead of mechanical guard"
  }
};

// Tap point query:
const diffBattery = catalog.getQuestionsByTag("diff");
const turnBattery = catalog.getQuestionsByTag("trajectory");
```

### Lifecycle Tap Points
1. **Pre-Tool Execution (`pre_tool_call`)**:
   Screen dangerous commands (`rm -rf`, `sudo`, `DROP TABLE`, unmasked secrets) before touching the host OS.
2. **On Diff Mutation (`turn_end`, `pre-push`)**:
   Enforce architectural taste (Torvalds taste, Ousterhout complexity, clean cutovers) and pokayoke structural fixes before commits land.
3. **Turn Trajectory (`every_n_turns`)**:
   Sample recent tool calls to detect spinning, repetitive errors, or off-intent drift.

---

## 4. Epistemic Rules & Jagged Edges

1. **Dual-Axis Gating (The Confidence Rule)**:
   * **Security Rules Fail Closed**: If `credential_leak` or `authority_escalation` has $P > 0.75$, block immediately.
   * **Subjective Rules Require Confidence**: Taste, Strategy, and Pokayoke checks must have both $P > \text{threshold}$ **AND** $\text{Confidence} \ge 0.70$ to block. Sub-threshold confidence is strictly an advisory warning. Never interrupt real work on low-confidence model hunches.
2. **Always Provide Escape Hatches**:
   In `Choice` questions, probability mass is normalized across the declared options. If the true answer is outside your options, Jev will force the probability onto the closest declared choice. **Always include an explicit escape option** (e.g. `none_of_these`, `feature_addition`, or `unrelated`).
3. **Direct, State-Aligned Phrasing**:
   Jev reads instructions literally and has no theory of mind.
   * Do not use double negatives ("Is this not un-safe?").
   * Align questions to the input state shape: phrasing a question about "diff hunks" when the state is "chat transcript" will degrade accuracy.
   * Frame Noul questions so that `true` represents the violation or target condition.
4. **Context Bounding & Chunking**:
   * Cap single-call state to $\approx 24,000\text{ characters}$ ($\approx 6\text{k tokens}$).
   * For multi-file commits, chunk by file boundaries rather than truncating the tail.
5. **Operational Fail-Open**:
   If the network times out or OpenRouter returns a 429/500 error, developer tools must fail open with a clear advisory notice. An external classifier outage must never prevent a developer or agent from working.

---

## 5. Workstation CLI Reference

In this workspace (`harness`):

```sh
# Review current working tree diff via OpenRouter Jev
pass-env run -f .env.pass -- bun omp-config/bin/omp-diff-review.ts

# Review staged changes
pass-env run -f .env.pass -- bun omp-config/bin/omp-diff-review.ts --staged

# Target specific battery
pass-env run -f .env.pass -- bun omp-config/bin/omp-diff-review.ts --battery taste
pass-env run -f .env.pass -- bun omp-config/bin/omp-diff-review.ts --battery security
pass-env run -f .env.pass -- bun omp-config/bin/omp-diff-review.ts --battery strategy

# In interactive OMP or Pi sessions:
/diff-review
/diff-review taste
/diff-review security
```
