from __future__ import annotations

import pytest

from app.models.enums import TemplateType
from app.services.template_renderer import (
    TemplateRenderError,
    TemplateSyntaxError,
    parse_variables,
    render,
    sanitize_value,
    validate_template,
)

BODY = "Hey {{username}}! Thanks for your interest.\nHere is your resource: {{resource_link}}"


def test_spec_example_renders() -> None:
    out = render(BODY, {"username": "ana", "resource_link": "https://x.test"})
    assert out.text == "Hey ana! Thanks for your interest.\nHere is your resource: https://x.test"
    assert out.used_variables == ("username", "resource_link")


def test_parse_and_validate() -> None:
    assert parse_variables("{{ username }} {{username}}") == ["username"]
    assert validate_template(BODY, {"resource_link"}) == ["username", "resource_link"]


@pytest.mark.parametrize(
    "body",
    ["", "   ", "Hi {{user name}}", "Hi {{__import__('os')}}", "Hi {{username}", "Hi username}}", "{{Username}}"],
)
def test_invalid_syntax(body: str) -> None:
    with pytest.raises(TemplateSyntaxError):
        validate_template(body)


def test_unsupported_variables_rejected() -> None:
    with pytest.raises(TemplateSyntaxError, match="Unsupported"):
        validate_template("Hi {{secret_key}}")


def test_fallbacks_and_missing() -> None:
    out = render("Hi {{username}}", {"username": None}, {"username": "there"})
    assert out.text == "Hi there"
    assert out.used_fallbacks == ("username",)
    with pytest.raises(TemplateRenderError, match="username"):
        render("Hi {{username}}", {})


def test_untrusted_values_are_sanitised_and_not_reevaluated() -> None:
    out = render("Hi {{username}}", {"username": "{{resource_link}}\x00\x07 evil\n\n"})
    assert out.text == "Hi resource_link evil"
    assert sanitize_value("a" * 1000).__len__() == 500


def test_length_limits_per_operation() -> None:
    with pytest.raises(TemplateRenderError, match="1000"):
        render(
            "{{comment_text}}{{comment_text}}{{comment_text}}",
            {"comment_text": "x" * 400},
            None,
            TemplateType.PRIVATE_REPLY,
        )
    assert render("{{comment_text}}", {"comment_text": "x" * 400}, None, TemplateType.PUBLIC_REPLY)
