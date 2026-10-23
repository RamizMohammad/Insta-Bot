from __future__ import annotations

import pytest

from app.models.enums import (
    EligibilityDecision,
    FallbackBehavior,
    FollowerRequirement,
    GroupOperator,
    MatchType,
    RuleAction,
    TriState,
)
from app.services.rule_engine import Rule, dedupe_key, evaluate, evaluate_eligibility, normalize_text


def test_spec_example_contains_case_insensitive() -> None:
    result = evaluate("Please send me the COURSE link!", [Rule("course", MatchType.CONTAINS)])
    assert result.matched is True
    assert [r.keyword for r in result.matched_rules] == ["course"]
    assert "matched 'course'" in result.reason


@pytest.mark.parametrize(
    ("text", "rule", "expected"),
    [
        ("I want the course", Rule("course", MatchType.KEYWORD), True),
        ("I want the courses", Rule("course", MatchType.KEYWORD), False),
        ("courses please", Rule("course", MatchType.CONTAINS), True),
        ("COURSE", Rule("course", MatchType.EXACT), True),
        ("course please", Rule("course", MatchType.EXACT), False),
        ("send   me\tthe  link", Rule("send me the link", MatchType.PHRASE), True),
        ("send me link", Rule("send me the link", MatchType.PHRASE), False),
        ("Course", Rule("course", MatchType.KEYWORD, case_sensitive=True), False),
        ("course", Rule("course", MatchType.KEYWORD, case_sensitive=True), True),
    ],
)
def test_match_types(text: str, rule: Rule, expected: bool) -> None:
    assert evaluate(text, [rule]).matched is expected


def test_unicode_and_normalisation() -> None:
    assert normalize_text("  Ｃｏｕｒｓｅ\u200b  please ") == "Course please"  # NFKC + zero-width + whitespace
    assert evaluate("Ｃｏｕｒｓｅ please", [Rule("course", MatchType.KEYWORD)]).matched
    assert evaluate("Quiero el CURSO 🎉", [Rule("curso", MatchType.KEYWORD)]).matched
    assert evaluate("STRASSE", [Rule("straße", MatchType.EXACT)]).matched  # casefold
    assert evaluate("こんにちは コース", [Rule("コース", MatchType.KEYWORD)]).matched


@pytest.mark.parametrize("bad", [None, "", "   ", 42, {"text": "course"}, ["course"]])
def test_empty_and_malformed_comments(bad: object) -> None:
    result = evaluate(bad, [Rule("course")])
    assert result.matched is False
    assert result.normalized_text is None
    assert "empty" in result.reason or "malformed" in result.reason


def test_exclusion_vetoes_match() -> None:
    rules = [Rule("course"), Rule("refund", MatchType.KEYWORD, action=RuleAction.EXCLUDE)]
    result = evaluate("course refund now", rules)
    assert result.matched is False
    assert [r.keyword for r in result.excluded_by] == ["refund"]


def test_multiple_include_keywords_or() -> None:
    rules = [Rule("course"), Rule("guide")]
    assert evaluate("send the guide", rules).matched
    assert not evaluate("hello", rules).matched


def test_and_group_requires_all() -> None:
    rules = [
        Rule("send", group="g", group_operator=GroupOperator.AND),
        Rule("link", group="g", group_operator=GroupOperator.AND),
    ]
    assert evaluate("send the link", rules).matched
    assert not evaluate("send it", rules).matched


def test_group_logic_and_or() -> None:
    rules = [Rule("course", group="a"), Rule("now", group="b")]
    assert evaluate("course", rules, GroupOperator.OR).matched
    result = evaluate("course", rules, GroupOperator.AND)
    assert not result.matched
    assert "b" in result.reason
    assert evaluate("course now", rules, GroupOperator.AND).matched


def test_no_include_rules_never_matches() -> None:
    result = evaluate("anything", [Rule("spam", action=RuleAction.EXCLUDE)])
    assert result.matched is False
    assert result.reason == "no include rules configured"


def test_explanations_for_every_rule() -> None:
    result = evaluate("course", [Rule("course"), Rule("guide"), Rule("course")])  # duplicate rule deduped
    assert len(result.results) == 2
    assert all(r.reason for r in result.results)
    assert result.to_dict()["matched"] is True


def test_does_not_match_raw_payload_only_comment_text() -> None:
    # The engine only ever sees the normalised comment text, never surrounding payload fields.
    assert not evaluate("hello", [Rule("comment")]).matched


@pytest.mark.parametrize(
    ("status", "requirement", "fallback", "decision"),
    [
        (TriState.UNKNOWN, FollowerRequirement.ANY, FallbackBehavior.SKIP, EligibilityDecision.PROCEED),
        (TriState.UNKNOWN, FollowerRequirement.FOLLOWERS_ONLY, FallbackBehavior.SKIP, EligibilityDecision.SKIP),
        (
            TriState.UNKNOWN,
            FollowerRequirement.FOLLOWERS_ONLY,
            FallbackBehavior.MANUAL_REVIEW,
            EligibilityDecision.MANUAL_REVIEW,
        ),
        (TriState.UNKNOWN, FollowerRequirement.FOLLOWERS_ONLY, FallbackBehavior.PROCEED, EligibilityDecision.PROCEED),
        (TriState.TRUE, FollowerRequirement.FOLLOWERS_ONLY, FallbackBehavior.SKIP, EligibilityDecision.PROCEED),
        (TriState.FALSE, FollowerRequirement.FOLLOWERS_ONLY, FallbackBehavior.PROCEED, EligibilityDecision.SKIP),
        (TriState.FALSE, FollowerRequirement.NON_FOLLOWERS_ONLY, FallbackBehavior.SKIP, EligibilityDecision.PROCEED),
    ],
)
def test_eligibility(status, requirement, fallback, decision) -> None:
    result = evaluate_eligibility(status, requirement, fallback)
    assert result.decision is decision
    assert result.observed == str(status)


def test_dedupe_key_scoped() -> None:
    assert dedupe_key("simulation", "c1", "ws1") != dedupe_key("simulation", "c1", "ws2")
    assert dedupe_key("instagram", "c1") == dedupe_key("instagram", "c1")


def test_comma_separated_alternatives() -> None:
    rule = Rule("guide, pdf", MatchType.CONTAINS)
    assert evaluate("send the PDF", [rule]).matched
    assert evaluate("the guide please", [rule]).matched
    result = evaluate("hello", [rule])
    assert "'guide' / 'pdf'" in result.results[0].reason
    exclusion = Rule("scam, fake, bot", MatchType.KEYWORD, action=RuleAction.EXCLUDE)
    assert not evaluate("guide from a bot", [rule, exclusion]).matched
    # Exact rules keep commas literally.
    assert evaluate("yes, please", [Rule("yes, please", MatchType.EXACT)]).matched
    assert not evaluate("yes", [Rule("yes, please", MatchType.EXACT)]).matched
