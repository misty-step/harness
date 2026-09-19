#!/usr/bin/env python3
"""Walk USER_STORIES criteria in a browser via Jev decisions.

Pass is a code postcondition. Jev DONE is a candidate, never a pass.
One Jev call per step with the fat battery; thresholds and routing live in
code. The provider is ``jev`` (OpenRouter decisions endpoint) or ``mock``
(replays a recorded answers fixture; the offline path, no network).

Exit codes:
  0  pass      every selected criterion met by code postcondition
  1  fail      fail_criterion, blocked, landed_wrong, lie, step limit
  2  hard error  bad args, no key, provider failure, missing mock fixture
  3  escalate  needs_vision, model ESCALATE, unresolved or dead-heat click
"""

from __future__ import annotations

import argparse
import fnmatch
import json
import os
import re
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

ENDPOINT = "https://openrouter.ai/api/alpha/decisions"
MODEL = "typesafe/jev-1.13"
X_TITLE = "harness-jev-qa-walk"
TIMEOUT_SECONDS = 20.0
MAX_STEPS = 10
PASS_CRITERION_FLOOR = 0.80

EXIT_PASS = 0
EXIT_FAIL = 1
EXIT_ERROR = 2
EXIT_ESCALATE = 3

OPS = {
    "CLICK": "Click one observed control to advance the current criterion.",
    "SCROLL_DOWN": "Needed control is below the fold.",
    "WAIT": "Page still loading.",
    "DONE": "Visible page already satisfies the current criterion.",
    "BLOCKED": "Login wall, crash, or missing app. Walk cannot continue.",
    "ESCALATE": (
        "Ambiguous controls, visual-only question, or not derivable from this "
        "table. Hand to a generative agent."
    ),
}

NOUL_KEYS = (
    "criterion_met",
    "criterion_partial",
    "page_broken",
    "empty_state",
    "overlay_trap",
    "lookalike_conflict",
    "needs_vision",
    "copy_lie",
    "primary_missing",
)
CHOICE_KEYS = ("which_screen",)

STORY_RE = re.compile(r"^##\s+(US-\d{3})\b\s*(.*)$")
CRIT_RE = re.compile(r"^\s*(\d+)\.\s+(.*)$")
WALK_RE = re.compile(r"<!--\s*walk:\s*(.*?)\s*-->")


class WalkError(RuntimeError):
    """A condition that makes the walk unable to run (exit 2)."""


# --------------------------------------------------------------------------
# Stories
# --------------------------------------------------------------------------


@dataclass
class Check:
    key: str
    value: str


@dataclass
class Criterion:
    number: int
    text: str
    checks: list[Check] = field(default_factory=list)


@dataclass
class Story:
    id: str
    title: str
    criteria: list[Criterion] = field(default_factory=list)


def parse_checks(raw: str) -> list[Check]:
    checks: list[Check] = []
    for part in raw.split(";"):
        part = part.strip()
        if not part:
            continue
        key, sep, value = part.partition("=")
        key = key.strip().lower()
        value = value.strip()
        if not sep or not value:
            raise WalkError(f"walk annotation clause is not key=value: {part!r}")
        if key not in ("path", "text", "heading"):
            raise WalkError(f"walk annotation key is not path, text, or heading: {key!r}")
        checks.append(Check(key, value))
    if not checks:
        raise WalkError("walk annotation holds no clauses")
    return checks


def parse_stories(path: Path) -> list[Story]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise WalkError(f"cannot read stories file {path}: {exc}") from exc
    stories: list[Story] = []
    story: Story | None = None
    criterion: Criterion | None = None
    for raw in text.splitlines():
        match = STORY_RE.match(raw)
        if match:
            story = Story(id=match.group(1), title=match.group(2).strip())
            stories.append(story)
            criterion = None
            continue
        if raw.startswith("## "):
            story = None
            criterion = None
            continue
        if story is None:
            continue
        crit = CRIT_RE.match(raw)
        if crit:
            criterion = Criterion(number=int(crit.group(1)), text=crit.group(2).strip())
            story.criteria.append(criterion)
        walk = WALK_RE.search(raw)
        if walk and criterion is not None:
            criterion.checks.extend(parse_checks(walk.group(1)))
    if not stories:
        raise WalkError(f"no '## US-XXX' stories found in {path}")
    return stories


def select_stories(stories: list[Story], ids: list[str] | None) -> list[Story]:
    if not ids:
        return stories
    wanted = set(ids)
    selected = [story for story in stories if story.id in wanted]
    missing = sorted(wanted - {story.id for story in selected})
    if missing:
        raise WalkError(f"story id not found: {', '.join(missing)}")
    return selected


def require_checks(story: Story) -> None:
    if not story.criteria:
        raise WalkError(f"{story.id} has no numbered criteria to walk")
    for criterion in story.criteria:
        if not criterion.checks:
            raise WalkError(
                f"{story.id} criterion {criterion.number} has no walk postcondition "
                "annotation; a pass is not representable"
            )


# --------------------------------------------------------------------------
# Observation
# --------------------------------------------------------------------------


@dataclass
class Element:
    id: str
    role: str
    name: str
    href: str | None = None
    current: bool = False


@dataclass
class Page:
    url: str
    title: str
    text: str
    elements: list[Element]


class Extractor(HTMLParser):
    """Collect the visible text and numbered element table from one page."""

    def __init__(self) -> None:
        super().__init__()
        self.title = ""
        self.visible: list[str] = []
        self.elements: list[Element] = []
        self._open: dict[str, Any] | None = None
        self._in_title = False
        self._in_body = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        data = dict(attrs)
        if tag == "body":
            self._in_body = True
        if tag == "title":
            self._in_title = True
        if tag == "a":
            self._open = {"role": "link", "href": data.get("href") or "", "name": ""}
        elif tag == "button":
            self._open = {"role": "button", "href": None, "name": ""}
        elif tag in ("h1", "h2", "h3"):
            self._open = {"role": "heading", "href": None, "name": ""}

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        if tag in ("a", "button", "h1", "h2", "h3") and self._open is not None:
            element = self._open
            self._open = None
            if element["role"] == "link" and not element["href"]:
                return
            if element["name"].strip():
                self.elements.append(
                    Element(
                        id="",
                        role=element["role"],
                        name=element["name"].strip(),
                        href=element.get("href"),
                    )
                )

    def handle_data(self, data: str) -> None:
        token = " ".join(data.split())
        if not token:
            return
        if self._in_title:
            self.title = f"{self.title} {token}".strip()
        if self._open is not None:
            self._open["name"] = f"{self._open['name']} {token}".strip()
        if self._in_body:
            self.visible.append(token)


def build_page(url: str, html: str) -> Page:
    extractor = Extractor()
    extractor.feed(html)
    extractor.close()
    current_path = urllib.parse.urlparse(url).path
    for index, element in enumerate(extractor.elements, start=1):
        element.id = str(index)
        if element.href is not None:
            target = urllib.parse.urljoin(url, element.href)
            element.current = urllib.parse.urlparse(target).path == current_path
    return Page(
        url=url,
        title=extractor.title,
        text=" ".join(extractor.visible),
        elements=extractor.elements,
    )


def fetch(url: str, timeout: float = TIMEOUT_SECONDS) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "jev-qa-walk/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        raise WalkError(f"GET {url} returned HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, OSError, ValueError) as exc:
        raise WalkError(f"GET {url} failed: {exc}") from exc


def observe(url: str) -> Page:
    return build_page(url, fetch(url))


def clickable(page: Page) -> list[Element]:
    return [element for element in page.elements if element.role in ("link", "button")]


def postcondition_met(criterion: Criterion, page: Page) -> bool:
    path = urllib.parse.urlparse(page.url).path
    for check in criterion.checks:
        if check.key == "path":
            if not fnmatch.fnmatch(path, check.value):
                return False
        elif check.key == "text":
            if check.value not in page.text:
                return False
        elif check.key == "heading":
            if not any(
                element.role == "heading" and check.value in element.name
                for element in page.elements
            ):
                return False
    return True


# --------------------------------------------------------------------------
# The fat battery and the state block
# --------------------------------------------------------------------------


def battery(page: Page) -> dict[str, dict[str, Any]]:
    click = {element.id: f"Click observed element {element.id}." for element in clickable(page)}
    click["none"] = "Not clicking."
    return {
        "operation": {
            "type": "choice",
            "instructions": (
                "Pick the next QA operation for the CURRENT criterion only. "
                "DONE only if that criterion is visibly satisfied. "
                "ESCALATE if the next click is a guess among lookalikes, "
                "or the criterion is about pixels/contrast/layout you cannot see."
            ),
            "criteria": OPS,
        },
        "click_target": {
            "type": "choice",
            "instructions": "If operation is CLICK, which observed element? Else none.",
            "criteria": click,
        },
        "which_screen": {
            "type": "choice",
            "instructions": "What kind of screen is this?",
            "criteria": {
                "dashboard": "App home / list of projects.",
                "project_desk": "A single project's desk.",
                "login": "Sign-in or auth wall.",
                "error": "Crash, 500, failed to load.",
                "empty": "Valid screen with no records.",
                "modal": "Dialog on top of another screen.",
                "unknown": "None of these.",
            },
        },
        "criterion_met": {
            "type": "noul",
            "instructions": "Does the visible page already fully satisfy the CURRENT criterion?",
            "criteria": {
                "true": "Every required UI fact in the criterion is visible now.",
                "false": "Missing, partial, wrong screen, or broken.",
            },
        },
        "criterion_partial": {
            "type": "noul",
            "instructions": "Is some but not all of the current criterion visible?",
            "criteria": {
                "true": "Heading or some widgets match; required pieces are missing.",
                "false": "Either fully met or not started.",
            },
        },
        "page_broken": {
            "type": "noul",
            "instructions": "Is this an error, crash, or unusable failure?",
            "criteria": {"true": "Error/crash/unusable.", "false": "Normal app screen."},
        },
        "empty_state": {
            "type": "noul",
            "instructions": "Is this a valid empty state (no records) rather than a crash?",
        },
        "overlay_trap": {
            "type": "noul",
            "instructions": "Is a modal, cookie banner, or overlay blocking the primary control?",
        },
        "lookalike_conflict": {
            "type": "noul",
            "instructions": "Are two or more visible controls equally plausible for the next click?",
            "criteria": {
                "true": "Lookalike names or duplicate actions; a click would be a guess.",
                "false": "One control clearly matches the criterion.",
            },
        },
        "needs_vision": {
            "type": "noul",
            "instructions": (
                "Must this criterion be judged from pixels (contrast, overlap, "
                "truncation, theme) rather than from the element table?"
            ),
            "criteria": {
                "true": "Appearance, contrast, overlap, or clipped type.",
                "false": "Settled by roles, names, URL, or visible text.",
            },
        },
        "copy_lie": {
            "type": "noul",
            "instructions": (
                "Does marketing or helper copy claim the criterion is done while "
                "the actual UI is not that screen?"
            ),
        },
        "primary_missing": {
            "type": "noul",
            "instructions": "Is the primary control the criterion needs absent from the element table?",
        },
        "qa_severity": {
            "type": "score",
            "instructions": "If this page is a defect relative to the criterion, how severe?",
            "criteria": [
                "No defect. Page is fine or just not there yet.",
                "Cosmetic or copy issue. Story still works.",
                "Story is blocked or the page is broken.",
            ],
        },
    }


def state_block(story: Story, criterion: Criterion, page: Page) -> str:
    rows = "\n".join(
        f"[{element.id}] {element.role:8} {element.name}"
        + (f"  href={element.href}" if element.href else "")
        + ("  (current)" if element.current else "")
        for element in page.elements
    )
    return (
        f"STORY: {story.title or story.id}\n"
        f"CURRENT CRITERION: {criterion.text}\n"
        f"URL: {page.url}\nTITLE: {page.title}\n"
        f"VISIBLE TEXT:\n{page.text}\n"
        f"CONSOLE: (none)\n"
        f"ELEMENTS:\n{rows}\n"
    )


# --------------------------------------------------------------------------
# Providers
# --------------------------------------------------------------------------


class MockProvider:
    """Replay recorded answers from a fixture; deterministic, offline."""

    name = "mock"

    def __init__(self, path: Path) -> None:
        self.path = path
        self._entries: list[dict[str, Any]] | None = None

    def _load(self) -> list[dict[str, Any]]:
        if self._entries is not None:
            return self._entries
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except OSError as exc:
            raise WalkError(f"mock fixture not readable: {self.path}: {exc}") from exc
        except json.JSONDecodeError as exc:
            raise WalkError(f"mock fixture is not JSON: {self.path}: {exc}") from exc
        entries = data.get("steps") if isinstance(data, dict) else None
        if not isinstance(entries, list) or not entries:
            raise WalkError(f"mock fixture needs a non-empty 'steps' array: {self.path}")
        for entry in entries:
            if not isinstance(entry, dict) or "url_contains" not in entry or "answers" not in entry:
                raise WalkError(f"mock fixture entry needs url_contains and answers: {self.path}")
        self._entries = entries
        return entries

    def answers(self, story: Story, criterion: Criterion, page: Page) -> dict[str, Any]:
        best: dict[str, Any] | None = None
        for entry in self._load():
            if str(entry["url_contains"]) not in page.url:
                continue
            if "text_contains" in entry and str(entry["text_contains"]) not in page.text:
                continue
            if best is None or len(str(entry["url_contains"])) > len(str(best["url_contains"])):
                best = entry
        if best is None:
            raise WalkError(f"mock fixture has no recorded answers for {page.url}")
        return best["answers"]


class JevProvider:
    """One call per step; the fat battery rides in parallel. No region scoring."""

    name = "jev"

    def __init__(self, api_key: str) -> None:
        self.api_key = api_key

    def answers(self, story: Story, criterion: Criterion, page: Page) -> dict[str, Any]:
        payload = json.dumps(
            {
                "model": MODEL,
                "state": state_block(story, criterion, page),
                "questions": battery(page),
            }
        ).encode()
        last = "no attempt"
        for attempt in (1, 2):
            request = urllib.request.Request(
                ENDPOINT,
                data=payload,
                method="POST",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://github.com/misty-step/harness",
                    "X-Title": X_TITLE,
                },
            )
            try:
                with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                    data = json.loads(response.read())
                answers = data.get("answers")
                if not isinstance(answers, dict):
                    raise WalkError("decisions response has no answers object")
                return answers
            except urllib.error.HTTPError as exc:
                last = f"HTTP {exc.code}"
                if attempt == 1 and (exc.code >= 500 or exc.code == 429):
                    continue
                raise WalkError(f"decisions call failed: {last}") from exc
            except (urllib.error.URLError, TimeoutError, OSError) as exc:
                last = str(exc)
                if attempt == 1:
                    continue
                raise WalkError(f"decisions call failed: {last}") from exc
            except json.JSONDecodeError as exc:
                raise WalkError(f"decisions response is not JSON: {exc}") from exc
        raise WalkError(f"decisions call failed: {last}")


# --------------------------------------------------------------------------
# Policy: code decides, Jev only suggests
# --------------------------------------------------------------------------


def answer_choice(answers: dict[str, Any], key: str, default: str = "none") -> str:
    answer = answers.get(key)
    if not isinstance(answer, dict):
        return default
    return str(answer.get("choice") or default)


def answer_conf(answers: dict[str, Any], key: str) -> float:
    answer = answers.get(key)
    if not isinstance(answer, dict):
        return 0.0
    try:
        return float(answer.get("confidence") or 0.0)
    except (TypeError, ValueError):
        return 0.0


def answer_noul(answers: dict[str, Any], key: str) -> float:
    answer = answers.get(key)
    if not isinstance(answer, dict):
        return 0.0
    try:
        return float(answer.get("noul") or 0.0)
    except (TypeError, ValueError):
        return 0.0


def answer_score(answers: dict[str, Any], key: str) -> float | None:
    answer = answers.get(key)
    if not isinstance(answer, dict) or answer.get("score") is None:
        return None
    try:
        return float(answer["score"])
    except (TypeError, ValueError):
        return None


def gap(answer: dict[str, Any] | None) -> float:
    if not isinstance(answer, dict):
        return 0.0
    probabilities = answer.get("probabilities")
    if not isinstance(probabilities, dict) or not probabilities:
        return 0.0
    values: list[float] = []
    for value in probabilities.values():
        try:
            values.append(float(value))
        except (TypeError, ValueError):
            continue
    values.sort(reverse=True)
    if not values:
        return 0.0
    if len(values) == 1:
        return values[0]
    return values[0] - values[1]


def decide(answers: dict[str, Any], click_ids: list[str]) -> dict[str, Any]:
    """Route one recorded decision set. Thresholds are code, not model output."""
    operation = answer_choice(answers, "operation", "ESCALATE")
    click_answer = answers.get("click_target")
    click = answer_choice(answers, "click_target")
    click_gap = gap(click_answer)
    vision = answer_noul(answers, "needs_vision")
    lookalike = answer_noul(answers, "lookalike_conflict")
    primary_missing = answer_noul(answers, "primary_missing")
    criterion_met = answer_noul(answers, "criterion_met")
    route = "escalate_agent"
    reason = "unrouted"
    if vision >= 0.7:
        route, reason = "escalate_vision", "vision"
    elif operation == "ESCALATE":
        route, reason = "escalate_agent", "model_escalate"
    elif lookalike >= 0.6 and click_gap < 0.10:
        route, reason = "escalate_agent", "lookalike_dead_heat"
    elif primary_missing >= 0.8 and criterion_met < 0.3:
        route, reason = "fail_criterion", "required_control_absent"
    elif operation == "CLICK" and click in click_ids and click_gap >= 0.15:
        route, reason = "act", "nav_click"
    elif operation == "CLICK":
        route, reason = "escalate_agent", "click_unresolved"
    elif operation == "DONE":
        route, reason = "done_candidate", "jev_done"
    elif operation == "BLOCKED":
        route, reason = "blocked", "jev_blocked"
    else:
        route, reason = "escalate_agent", "op_unsupported"
    return {
        "route": route,
        "reason": reason,
        "op": operation,
        "op_conf": answer_conf(answers, "operation"),
        "op_gap": round(gap(answers.get("operation")), 3),
        "click": click,
        "click_conf": answer_conf(answers, "click_target"),
        "click_gap": round(click_gap, 3),
        "criterion_met": criterion_met,
        "criterion_partial": answer_noul(answers, "criterion_partial"),
        "page_broken": answer_noul(answers, "page_broken"),
        "lookalike": lookalike,
        "needs_vision": vision,
        "copy_lie": answer_noul(answers, "copy_lie"),
        "primary_missing": primary_missing,
        "which_screen": answer_choice(answers, "which_screen", "unknown"),
        "qa_severity": answer_score(answers, "qa_severity"),
        "empty_state": answer_noul(answers, "empty_state"),
        "overlay_trap": answer_noul(answers, "overlay_trap"),
    }


def resolve_done(criterion_met: float, postcondition: bool) -> tuple[str, str]:
    """DONE is a candidate. Code owns the pass bit."""
    if postcondition and criterion_met >= PASS_CRITERION_FLOOR:
        return "pass", "code_postcondition"
    if criterion_met >= PASS_CRITERION_FLOOR:
        return "fail", "lie"
    return "fail", "done_unproven"


# --------------------------------------------------------------------------
# The walk
# --------------------------------------------------------------------------


def walk_story(
    story: Story,
    provider: MockProvider | JevProvider,
    start_url: str,
    emit: Any = print,
) -> dict[str, Any]:
    results: list[dict[str, Any]] = []
    steps_total = 0
    current_url = start_url
    for criterion in story.criteria:
        outcome: dict[str, Any] = {
            "number": criterion.number,
            "text": criterion.text,
            "checks": [f"{check.key}={check.value}" for check in criterion.checks],
            "steps": [],
        }
        try:
            page = observe(current_url)
        except WalkError as exc:
            outcome.update(outcome="fail", reason="blocked", detail=str(exc))
            results.append(outcome)
            emit(f"[{story.id}] criterion {criterion.number}: fail (blocked) {exc}")
            break
        steps = 0
        while True:
            if postcondition_met(criterion, page):
                outcome.update(outcome="pass", reason="code_postcondition")
                emit(f"[{story.id}] criterion {criterion.number}: pass (code postcondition)")
                break
            if steps >= MAX_STEPS:
                outcome.update(outcome="fail", reason="step_limit")
                emit(f"[{story.id}] criterion {criterion.number}: fail (step_limit)")
                break
            ids = [element.id for element in clickable(page)]
            try:
                answers = provider.answers(story, criterion, page)
            except WalkError as exc:
                raise WalkError(f"{story.id} criterion {criterion.number}: {exc}") from exc
            decision = decide(answers, ids)
            step = {
                "step": steps + 1,
                "url": page.url,
                "provider": provider.name,
                **decision,
            }
            steps_total += 1
            route = decision["route"]
            emit(
                f"[{story.id}] criterion {criterion.number}: step {step['step']} "
                f"{route}/{decision['reason']} op={decision['op']} click={decision['click']} "
                f"op_conf={decision['op_conf']:.2f} click_gap={decision['click_gap']:.2f} "
                f"crit={decision['criterion_met']:.2f}"
            )
            if route == "act":
                element = next((item for item in clickable(page) if item.id == decision["click"]), None)
                if element is None or not element.href:
                    step.update(verdict="escalate_agent", reason="unactionable_click")
                    outcome.update(outcome="escalate", reason="agent")
                    outcome["steps"].append(step)
                    emit(f"[{story.id}] criterion {criterion.number}: escalate (agent: unactionable click)")
                    break
                target = urllib.parse.urljoin(page.url, element.href)
                step["followed"] = target
                try:
                    landing = build_page(target, fetch(target))
                except WalkError as exc:
                    step.update(verdict="landed_wrong", detail=str(exc))
                    outcome.update(outcome="fail", reason="landed_wrong")
                    outcome["steps"].append(step)
                    emit(f"[{story.id}] criterion {criterion.number}: fail (landed_wrong) {exc}")
                    break
                outcome["steps"].append(step)
                current_url = target
                page = landing
                steps += 1
                continue
            outcome["steps"].append(step)
            if route == "done_candidate":
                result, why = resolve_done(decision["criterion_met"], False)
                outcome.update(outcome=result, reason=why)
                emit(f"[{story.id}] criterion {criterion.number}: {result} ({why})")
            elif route == "fail_criterion":
                outcome.update(outcome="fail", reason="fail_criterion")
                emit(f"[{story.id}] criterion {criterion.number}: fail (fail_criterion)")
            elif route == "blocked":
                outcome.update(outcome="fail", reason="blocked")
                emit(f"[{story.id}] criterion {criterion.number}: fail (blocked)")
            elif route == "escalate_vision":
                outcome.update(outcome="escalate", reason="vision")
                emit(f"[{story.id}] criterion {criterion.number}: escalate (vision)")
            else:
                outcome.update(outcome="escalate", reason="agent")
                emit(f"[{story.id}] criterion {criterion.number}: escalate (agent)")
            break
        results.append(outcome)
        if outcome["outcome"] != "pass":
            break
    if len(results) == len(story.criteria) and all(item["outcome"] == "pass" for item in results):
        verdict, reason, code = "pass", "code_postcondition", EXIT_PASS
    else:
        last = results[-1] if results else {"outcome": "fail", "reason": "no_criteria"}
        verdict = last["outcome"]
        reason = last["reason"]
        code = EXIT_FAIL if verdict == "fail" else EXIT_ESCALATE
    return {
        "story": story.id,
        "title": story.title,
        "url": start_url,
        "provider": provider.name,
        "criteria": results,
        "steps": steps_total,
        "verdict": verdict,
        "reason": reason,
        "exit_code": code,
    }


# --------------------------------------------------------------------------
# Frozen self-test: spike 003 decisions, no network
# --------------------------------------------------------------------------


def _choice(choice: str, confidence: float, probabilities: dict[str, float]) -> dict[str, Any]:
    return {"choice": choice, "confidence": confidence, "probabilities": probabilities}


def _noul(value: float) -> dict[str, Any]:
    return {"noul": value}


def _score(value: float) -> dict[str, Any]:
    return {"score": value}


def frozen_cases() -> dict[str, tuple[dict[str, Any], list[str]]]:
    """Recorded Jev answers from the live spike (003-challenge, second run)."""
    lookalike = {
        "operation": _choice("CLICK", 0.98, {"CLICK": 0.98, "DONE": 0.01, "ESCALATE": 0.01}),
        "click_target": _choice(
            "2", 0.90,
            {"1": 0.00, "2": 0.90, "3": 0.06, "4": 0.03, "5": 0.01, "none": 0.00},
        ),
        "which_screen": _choice("dashboard", 0.92, {"dashboard": 0.92, "unknown": 0.08}),
        "criterion_met": _noul(0.08),
        "criterion_partial": _noul(0.41),
        "page_broken": _noul(0.08),
        "empty_state": _noul(0.37),
        "overlay_trap": _noul(0.03),
        "lookalike_conflict": _noul(0.19),
        "needs_vision": _noul(0.07),
        "copy_lie": _noul(0.09),
        "primary_missing": _noul(0.11),
        "qa_severity": _score(0.81),
    }
    partial = {
        "operation": _choice(
            "CLICK", 0.67,
            {"CLICK": 0.67, "ESCALATE": 0.06, "DONE": 0.07, "BLOCKED": 0.07,
             "WAIT": 0.07, "SCROLL_DOWN": 0.06},
        ),
        "click_target": _choice(
            "none", 0.56,
            {"none": 0.56, "4": 0.19, "1": 0.15, "2": 0.05, "3": 0.05},
        ),
        "which_screen": _choice("project_desk", 0.88, {"project_desk": 0.88, "error": 0.12}),
        "criterion_met": _noul(0.02),
        "criterion_partial": _noul(0.96),
        "page_broken": _noul(0.50),
        "empty_state": _noul(0.77),
        "overlay_trap": _noul(0.04),
        "lookalike_conflict": _noul(0.29),
        "needs_vision": _noul(0.09),
        "copy_lie": _noul(0.10),
        "primary_missing": _noul(0.91),
        "qa_severity": _score(1.90),
    }
    visual = {
        "operation": _choice(
            "ESCALATE", 0.95,
            {"ESCALATE": 0.95, "CLICK": 0.01, "DONE": 0.01, "BLOCKED": 0.01,
             "WAIT": 0.01, "SCROLL_DOWN": 0.01},
        ),
        "click_target": _choice("none", 0.78, {"none": 0.78, "1": 0.08, "2": 0.08, "3": 0.06}),
        "which_screen": _choice("dashboard", 0.90, {"dashboard": 0.90, "unknown": 0.10}),
        "criterion_met": _noul(0.23),
        "criterion_partial": _noul(0.55),
        "page_broken": _noul(0.24),
        "empty_state": _noul(0.45),
        "overlay_trap": _noul(0.03),
        "lookalike_conflict": _noul(0.39),
        "needs_vision": _noul(0.89),
        "copy_lie": _noul(0.11),
        "primary_missing": _noul(0.72),
        "qa_severity": _score(1.17),
    }
    copy_lie = {
        "operation": _choice(
            "CLICK", 0.78,
            {"CLICK": 0.78, "DONE": 0.13, "ESCALATE": 0.05, "BLOCKED": 0.02,
             "WAIT": 0.01, "SCROLL_DOWN": 0.01},
        ),
        "click_target": _choice("2", 0.73, {"2": 0.73, "3": 0.13, "1": 0.08, "none": 0.06}),
        "which_screen": _choice("dashboard", 0.90, {"dashboard": 0.90, "unknown": 0.10}),
        "criterion_met": _noul(0.21),
        "criterion_partial": _noul(0.49),
        "page_broken": _noul(0.08),
        "empty_state": _noul(0.62),
        "overlay_trap": _noul(0.04),
        "lookalike_conflict": _noul(0.19),
        "needs_vision": _noul(0.07),
        "copy_lie": _noul(0.75),
        "primary_missing": _noul(0.25),
        "qa_severity": _score(0.86),
    }
    happy = {
        "operation": _choice(
            "DONE", 0.93,
            {"DONE": 0.93, "CLICK": 0.03, "ESCALATE": 0.02, "BLOCKED": 0.01,
             "WAIT": 0.005, "SCROLL_DOWN": 0.005},
        ),
        "click_target": _choice("none", 0.54, {"none": 0.54, "3": 0.21, "2": 0.15, "1": 0.10}),
        "which_screen": _choice("project_desk", 0.94, {"project_desk": 0.94, "unknown": 0.06}),
        "criterion_met": _noul(0.92),
        "criterion_partial": _noul(0.32),
        "page_broken": _noul(0.03),
        "empty_state": _noul(0.21),
        "overlay_trap": _noul(0.02),
        "lookalike_conflict": _noul(0.31),
        "needs_vision": _noul(0.07),
        "copy_lie": _noul(0.07),
        "primary_missing": _noul(0.49),
        "qa_severity": _score(0.05),
    }
    low_conf_click = {
        # First spike run: a 0.70 operation floor blocked this correct click at 0.67.
        "operation": _choice(
            "CLICK", 0.67,
            {"CLICK": 0.67, "ESCALATE": 0.06, "DONE": 0.07, "BLOCKED": 0.07,
             "WAIT": 0.07, "SCROLL_DOWN": 0.06},
        ),
        "click_target": _choice("2", 0.83, {"2": 0.83, "3": 0.07, "1": 0.06, "none": 0.04}),
        "which_screen": _choice("dashboard", 0.90, {"dashboard": 0.90, "unknown": 0.10}),
        "criterion_met": _noul(0.12),
        "criterion_partial": _noul(0.44),
        "page_broken": _noul(0.06),
        "empty_state": _noul(0.30),
        "overlay_trap": _noul(0.02),
        "lookalike_conflict": _noul(0.20),
        "needs_vision": _noul(0.05),
        "copy_lie": _noul(0.08),
        "primary_missing": _noul(0.30),
        "qa_severity": _score(0.60),
    }
    return {
        "lookalike_habitat": (lookalike, ["1", "2", "3", "4", "5"]),
        "partial_desk": (partial, ["1", "2", "3", "4"]),
        "visual_only": (visual, ["1", "2", "3"]),
        "copy_lie": (copy_lie, ["1", "2", "3"]),
        "happy_desk": (happy, ["1", "2", "3", "4"]),
        "low_conf_click": (low_conf_click, ["1", "2", "3", "4", "5"]),
    }


def self_test(emit: Any = print) -> int:
    failures: list[str] = []

    def check(label: str, condition: bool) -> None:
        if not condition:
            failures.append(label)

    cases = frozen_cases()

    answers, ids = cases["lookalike_habitat"]
    decision = decide(answers, ids)
    check("lookalike clicks the exact Habitat element", decision["route"] == "act")
    check("lookalike picks element 2, not settings or archive", decision["click"] == "2")
    check("lookalike click gap is decisive", decision["click_gap"] >= 0.15)

    answers, ids = cases["partial_desk"]
    decision = decide(answers, ids)
    check("partial desk fails the criterion", decision["route"] == "fail_criterion")
    check("partial desk names the absent control", decision["reason"] == "required_control_absent")

    answers, ids = cases["visual_only"]
    decision = decide(answers, ids)
    check("visual-only criterion escalates to vision", decision["route"] == "escalate_vision")

    answers, ids = cases["copy_lie"]
    decision = decide(answers, ids)
    check("copy lie is not DONE", decision["op"] != "DONE")
    check("copy lie still navigates", decision["route"] == "act")
    check("copy lie is recorded for the report", decision["copy_lie"] >= 0.5)

    answers, ids = cases["happy_desk"]
    decision = decide(answers, ids)
    check("happy desk is a DONE candidate only", decision["route"] == "done_candidate")
    check("DONE plus postcondition passes", resolve_done(decision["criterion_met"], True) == ("pass", "code_postcondition"))
    check("DONE minus postcondition is a lie", resolve_done(decision["criterion_met"], False) == ("fail", "lie"))

    answers, ids = cases["low_conf_click"]
    decision = decide(answers, ids)
    check("a 0.67-confidence correct click still acts", decision["route"] == "act")
    check("the 0.67 click is element 2", decision["click"] == "2")

    dead_heat = dict(cases["lookalike_habitat"][0])
    dead_heat["lookalike_conflict"] = _noul(0.62)
    dead_heat["click_target"] = _choice("2", 0.60, {"2": 0.60, "3": 0.53, "1": 0.05})
    check(
        "lookalike plus dead heat escalates",
        decide(dead_heat, ["1", "2", "3"])["route"] == "escalate_agent",
    )
    below_vision = dict(cases["visual_only"][0])
    below_vision["needs_vision"] = _noul(0.69)
    below_vision["operation"] = _choice("CLICK", 0.9, {"CLICK": 0.9, "DONE": 0.1})
    below_vision["click_target"] = _choice("2", 0.8, {"2": 0.8, "1": 0.1, "3": 0.1})
    check(
        "vision below the floor does not escalate",
        decide(below_vision, ["1", "2", "3"])["route"] == "act",
    )

    scratch = tempfile.TemporaryDirectory(prefix="jev-qa-walk-self-test-", dir=_scratch_base())
    try:
        parsed = parse_stories(_write_parse_fixture(Path(scratch.name)))
        story = parsed[0]
        check("parse finds the story id", story.id == "US-901")
        check("parse reads the criterion text", story.criteria[0].text.startswith("WHEN"))
        check(
            "parse reads every check key",
            [clause.key for clause in story.criteria[0].checks] == ["path", "text", "heading"],
        )

        provider = MockProvider(_write_mock_fixture(Path(scratch.name)))
        page = Page(
            url="http://example.test/projects/habitat",
            title="t",
            text="Habitat desk",
            elements=[],
        )
        replayed = provider.answers(story, story.criteria[0], page)
        check("mock replay matches on the longest url_contains", replayed["operation"]["choice"] == "DONE")
        try:
            provider.answers(
                story,
                story.criteria[0],
                Page(url="http://example.test/none", title="", text="", elements=[]),
            )
            check("mock replay fails closed without a match", False)
        except WalkError:
            pass
    finally:
        scratch.cleanup()

    if failures:
        for failure in failures:
            emit(f"self-test: {failure}", file=sys.stderr)
        return 1
    emit("walk self-test OK")
    return 0


def _scratch_base() -> str:
    base = os.environ.get("TMPDIR") or str(Path.home() / ".cache" / "tmp")
    Path(base).mkdir(parents=True, exist_ok=True)
    return base


def _write_parse_fixture(root: Path) -> Path:
    path = root / "stories.md"
    path.write_text(
        "# Stories\n\n## US-901 Fixture desk\n\nStatement: When I work, I want a desk.\n\n"
        "Criteria:\n1. WHEN I select Habitat, THE SYSTEM SHALL show the desk.\n"
        "   <!-- walk: path=/habitat.html; text=Habitat desk; heading=Habitat desk -->\n",
        encoding="utf-8",
    )
    return path


def _write_mock_fixture(root: Path) -> Path:
    path = root / "walk-mock.json"
    path.write_text(
        json.dumps(
            {
                "steps": [
                    {
                        "url_contains": "/dashboard",
                        "answers": {
                            "operation": {
                                "choice": "CLICK",
                                "confidence": 0.9,
                                "probabilities": {"CLICK": 0.9, "DONE": 0.1},
                            }
                        },
                    },
                    {
                        "url_contains": "/projects",
                        "answers": {
                            "operation": {
                                "choice": "CLICK",
                                "confidence": 0.6,
                                "probabilities": {"CLICK": 0.6, "DONE": 0.4},
                            }
                        },
                    },
                    {
                        "url_contains": "/projects/habitat",
                        "answers": {
                            "operation": {
                                "choice": "DONE",
                                "confidence": 0.9,
                                "probabilities": {"DONE": 0.9, "CLICK": 0.1},
                            }
                        },
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    return path


# --------------------------------------------------------------------------
# Entry point
# --------------------------------------------------------------------------


def build_provider(name: str, stories_path: Path) -> MockProvider | JevProvider:
    if name == "mock":
        fixture = os.environ.get("WALK_MOCK_FIXTURE")
        path = Path(fixture) if fixture else stories_path.parent / "walk-mock.json"
        return MockProvider(path)
    api_key = os.environ.get("OPENROUTER_API_KEY", "").strip()
    if not api_key:
        raise WalkError("OPENROUTER_API_KEY is not set and provider is jev")
    return JevProvider(api_key)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="walk.py",
        description="Walk USER_STORIES criteria in a browser via Jev decisions.",
    )
    parser.add_argument("--url", help="Candidate URL to walk")
    parser.add_argument("--stories", type=Path, help="USER_STORIES.md path")
    parser.add_argument(
        "--id", action="append", dest="ids", metavar="US-XXX",
        help="Story id to walk; repeatable; default all stories in the file",
    )
    parser.add_argument("--trace", type=Path, help="Write the JSON walk trace here")
    parser.add_argument("--provider", choices=("mock", "jev"), default="jev")
    parser.add_argument("--self-test", action="store_true", help="Run the offline frozen checks")
    args = parser.parse_args(argv)

    if args.self_test:
        return self_test()
    if not args.url or not args.stories:
        parser.error("--url and --stories are required")
    try:
        if not args.url.startswith(("http://", "https://")):
            raise WalkError(f"--url must be http or https: {args.url}")
        stories = select_stories(parse_stories(args.stories), args.ids)
        for story in stories:
            require_checks(story)
        provider = build_provider(args.provider, args.stories)
        runs = [walk_story(story, provider, args.url) for story in stories]
        if any(run["exit_code"] == EXIT_FAIL for run in runs):
            code = EXIT_FAIL
        elif any(run["exit_code"] == EXIT_ESCALATE for run in runs):
            code = EXIT_ESCALATE
        else:
            code = EXIT_PASS
        verdict = {EXIT_PASS: "pass", EXIT_FAIL: "fail", EXIT_ESCALATE: "escalate"}[code]
        if args.trace:
            try:
                args.trace.write_text(
                    json.dumps(
                        {
                            "provider": provider.name,
                            "stories": str(args.stories),
                            "url": args.url,
                            "runs": runs,
                            "verdict": verdict,
                            "exit_code": code,
                        },
                        indent=2,
                    )
                    + "\n",
                    encoding="utf-8",
                )
            except OSError as exc:
                raise WalkError(f"cannot write trace {args.trace}: {exc}") from exc
        print(f"walk: {verdict} ({len(runs)} stor{'y' if len(runs) == 1 else 'ies'})")
        return code
    except WalkError as exc:
        print(f"walk: {exc}", file=sys.stderr)
        return EXIT_ERROR


if __name__ == "__main__":
    raise SystemExit(main())
