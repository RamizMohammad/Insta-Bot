"""Standalone comment rule engine.

Pure Python: no FastAPI, database or Meta API dependencies, so it can be unit-tested and reused by
both live webhooks and simulation mode.

Semantics
---------
* The comment text is normalised (NFKC, zero-width characters removed, whitespace collapsed).
* Any matching *exclude* rule vetoes the match.
* *Include* rules are grouped by ``group``. A group with operator ``and`` matches when all of its
  rules match; ``or`` when any rule matches.
* Groups are combined with ``group_logic`` (``or`` by default, ``and`` to require every group).
* A rule set without include rules never matches (nothing positive was configured).
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable, Sequence
from dataclasses import asdict, dataclass, field
from functools import lru_cache
from typing import Any

from app.models.enums import (
    EligibilityDecision,
    FallbackBehavior,
    FollowerRequirement,
    GroupOperator,
    MatchType,
    RuleAction,
    TriState,
)

MAX_COMMENT_LENGTH = 10_000
_ZERO_WIDTH = dict.fromkeys(map(ord, "\u200b‌‍⁠﻿"))


@dataclass(frozen=True, slots=True)
class Rule:
    keyword: str
    match_type: MatchType = MatchType.CONTAINS
    case_sensitive: bool = False
    action: RuleAction = RuleAction.INCLUDE
    group: str = "default"
    group_operator: GroupOperator = GroupOperator.OR
    id: str | None = None


@dataclass(slots=True)
class RuleResult:
    rule_id: str | None
    keyword: str
    match_type: str
    action: str
    group: str
    matched: bool
    reason: str


@dataclass(slots=True)
class RuleEvaluation:
    matched: bool
    reason: str
    normalized_text: str | None
    matched_rules: list[RuleResult] = field(default_factory=list)
    excluded_by: list[RuleResult] = field(default_factory=list)
    groups: dict[str, bool] = field(default_factory=dict)
    results: list[RuleResult] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(slots=True)
class EligibilityResult:
    decision: EligibilityDecision
    condition: str
    observed: str
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {k: str(v) for k, v in asdict(self).items()}


def normalize_text(text: Any) -> str | None:
    """Return Unicode-normalised, whitespace-collapsed text, or ``None`` if unusable."""
    if not isinstance(text, str):
        return None
    text = unicodedata.normalize("NFKC", text[:MAX_COMMENT_LENGTH]).translate(_ZERO_WIDTH)
    collapsed = " ".join(text.split())
    return collapsed or None


@lru_cache(maxsize=1024)
def _word_pattern(needle: str, case_sensitive: bool) -> re.Pattern[str]:
    # Whole-word match that works for any Unicode script; inner whitespace matches any whitespace run.
    body = r"\s+".join(re.escape(part) for part in needle.split(" "))
    flags = 0 if case_sensitive else re.IGNORECASE
    return re.compile(rf"(?<!\w){body}(?!\w)", flags)


def alternatives(rule: Rule) -> list[str]:
    """Comma-separated keywords are alternatives (any may match), except for exact-comment rules."""
    parts = [rule.keyword] if rule.match_type is MatchType.EXACT else rule.keyword.split(",")
    return [n for n in (normalize_text(p) for p in parts) if n]


def _match_one(match_type: MatchType, needle: str, haystack: str) -> bool:
    if match_type is MatchType.EXACT:
        return haystack == needle
    if match_type is MatchType.CONTAINS:
        return needle in haystack
    return _word_pattern(needle, True).search(haystack) is not None


_VERBS = {
    MatchType.EXACT: ("equals", "does not equal"),
    MatchType.CONTAINS: ("contains", "does not contain"),
    MatchType.KEYWORD: ("has the word", "does not have the word"),
    MatchType.PHRASE: ("has the phrase", "does not have the phrase"),
}


def _match(rule: Rule, text: str, folded: str) -> tuple[bool, str]:
    needles = alternatives(rule)
    if not needles:
        return False, "rule keyword is empty"
    haystack = text if rule.case_sensitive else folded
    yes, no = _VERBS[rule.match_type]
    for needle in needles:
        if _match_one(rule.match_type, needle if rule.case_sensitive else needle.casefold(), haystack):
            return True, f"comment {yes} '{needle}'"
    quoted = " / ".join(f"'{n}'" for n in needles)
    return False, f"comment {no} {quoted}"


def _dedupe(rules: Iterable[Rule]) -> list[Rule]:
    seen: set[tuple[Any, ...]] = set()
    unique: list[Rule] = []
    for rule in rules:
        key = (rule.keyword, rule.match_type, rule.case_sensitive, rule.action, rule.group)
        if key not in seen:
            seen.add(key)
            unique.append(rule)
    return unique


def evaluate(comment_text: Any, rules: Sequence[Rule], group_logic: GroupOperator = GroupOperator.OR) -> RuleEvaluation:
    """Evaluate ``rules`` against the comment and explain the outcome."""
    text = normalize_text(comment_text)
    if text is None:
        reason = "comment is empty" if isinstance(comment_text, str) else "comment text is missing or malformed"
        return RuleEvaluation(matched=False, reason=reason, normalized_text=None)

    folded = text.casefold()
    results: list[RuleResult] = []
    for rule in _dedupe(rules):
        ok, why = _match(rule, text, folded)
        results.append(RuleResult(rule.id, rule.keyword, str(rule.match_type), str(rule.action), rule.group, ok, why))

    excluded = [r for r in results if r.action == RuleAction.EXCLUDE and r.matched]
    include_results = [r for r in results if r.action == RuleAction.INCLUDE]

    operators: dict[str, GroupOperator] = {}
    for rule in rules:
        if rule.action is RuleAction.INCLUDE:
            operators.setdefault(rule.group, rule.group_operator)
    groups: dict[str, bool] = {}
    for group, op in operators.items():
        members = [r.matched for r in include_results if r.group == group]
        groups[group] = all(members) if op is GroupOperator.AND else any(members)

    matched_rules = [r for r in include_results if r.matched]
    evaluation = RuleEvaluation(
        matched=False,
        reason="",
        normalized_text=text,
        matched_rules=matched_rules,
        excluded_by=excluded,
        groups=groups,
        results=results,
    )
    if excluded:
        evaluation.reason = "excluded by " + ", ".join(f"'{r.keyword}'" for r in excluded)
    elif not groups:
        evaluation.reason = "no include rules configured"
    else:
        combined = all(groups.values()) if group_logic is GroupOperator.AND else any(groups.values())
        evaluation.matched = combined
        if combined:
            evaluation.reason = "matched " + ", ".join(f"'{r.keyword}'" for r in matched_rules)
        else:
            failed = [g for g, ok in groups.items() if not ok]
            evaluation.reason = (
                "no matching include rules"
                if len(failed) == len(groups)
                else ("group(s) not satisfied: " + ", ".join(failed))
            )
    return evaluation


def evaluate_eligibility(
    follower_status: TriState,
    requirement: FollowerRequirement,
    unknown_fallback: FallbackBehavior,
) -> EligibilityResult:
    """Check the follower condition. ``unknown`` is never coerced to true/false; the fallback decides."""
    observed = str(follower_status)
    if requirement is FollowerRequirement.ANY:
        return EligibilityResult(EligibilityDecision.PROCEED, str(requirement), observed, "no follower condition")
    if follower_status is TriState.UNKNOWN:
        decision = EligibilityDecision(str(unknown_fallback))
        return EligibilityResult(
            decision, str(requirement), observed, f"follower status unknown; fallback '{unknown_fallback}' applied"
        )
    wants_follower = requirement is FollowerRequirement.FOLLOWERS_ONLY
    is_follower = follower_status is TriState.TRUE
    if wants_follower == is_follower:
        return EligibilityResult(EligibilityDecision.PROCEED, str(requirement), observed, "follower condition met")
    return EligibilityResult(EligibilityDecision.SKIP, str(requirement), observed, "follower condition not met")


def dedupe_key(source: str, external_id: str, scope: str = "") -> str:
    """Stable idempotency key for an incoming event (backed by a DB unique constraint)."""
    return f"{source}:{scope}:{external_id}"[:255]
