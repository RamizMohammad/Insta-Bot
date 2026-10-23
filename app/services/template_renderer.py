"""Safe ``{{variable}}`` template parsing and rendering (no expression evaluation, single pass).

Rendering is deliberately separate from sending: it produces text, and the automation service
validates that text against the target API operation before any adapter is called.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass

from app.models.enums import TemplateType

# Variables the automation engine can always supply (or explicitly cannot, e.g. username may be absent).
SYSTEM_VARIABLES = frozenset({"username", "comment_text", "campaign_name"})
_PLACEHOLDER = re.compile(r"\{\{\s*([^{}]*?)\s*\}\}")
_IDENTIFIER = re.compile(r"^[a-z_][a-z0-9_]{0,63}$")
_CONTROL = re.compile(r"[\u0000-\u0008\u000b-\u001f\u007f-\u009f]")

# Text limits enforced before calling Instagram (comment replies vs. private-reply messages).
MAX_LENGTH: dict[TemplateType, int] = {TemplateType.PUBLIC_REPLY: 2200, TemplateType.PRIVATE_REPLY: 1000}
MAX_VARIABLE_VALUE_LENGTH = 500


class TemplateSyntaxError(ValueError):
    pass


class TemplateRenderError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class RenderResult:
    text: str
    used_variables: tuple[str, ...]
    used_fallbacks: tuple[str, ...]


def parse_variables(body: str) -> list[str]:
    """Return placeholder names in order of first use, validating syntax."""
    if not body or not body.strip():
        raise TemplateSyntaxError("Template body must not be empty.")
    names: list[str] = []
    for match in _PLACEHOLDER.finditer(body):
        name = match.group(1)
        if not _IDENTIFIER.fullmatch(name):
            raise TemplateSyntaxError(
                f"Invalid placeholder '{{{{{name}}}}}': use lowercase names like {{{{username}}}}."
            )
        if name not in names:
            names.append(name)
    leftover = _PLACEHOLDER.sub("", body)
    if "{{" in leftover or "}}" in leftover:
        raise TemplateSyntaxError("Unbalanced '{{' or '}}' in template body.")
    if "{%" in body or "%}" in body:
        raise TemplateSyntaxError("Only {{variable}} placeholders are supported; logic blocks are not.")
    return names


def validate_template(
    body: str, custom_variables: set[str] | frozenset[str] = frozenset(), fallbacks: Mapping[str, str] | None = None
) -> list[str]:
    """Validate syntax and that every placeholder is supported. Returns the placeholder list."""
    names = parse_variables(body)
    for name in custom_variables:
        if not _IDENTIFIER.fullmatch(name):
            raise TemplateSyntaxError(f"Invalid custom variable name '{name}'.")
    allowed = SYSTEM_VARIABLES | set(custom_variables)
    unsupported = [n for n in names if n not in allowed]
    if unsupported:
        raise TemplateSyntaxError(
            "Unsupported variable(s): " + ", ".join(unsupported) + ". Declare them as custom variables."
        )
    for key in fallbacks or {}:
        if key not in names:
            raise TemplateSyntaxError(f"Fallback defined for unused variable '{key}'.")
    return names


def sanitize_value(value: object) -> str:
    """Make untrusted variable content safe to embed: no control chars or template delimiters."""
    text = unicodedata.normalize("NFKC", str(value))
    text = _CONTROL.sub("", text).replace("{{", "").replace("}}", "")
    return " ".join(text.split())[:MAX_VARIABLE_VALUE_LENGTH]


def render(
    body: str,
    context: Mapping[str, object | None],
    fallbacks: Mapping[str, str] | None = None,
    template_type: TemplateType | None = None,
) -> RenderResult:
    fallbacks = fallbacks or {}
    used: list[str] = []
    used_fallbacks: list[str] = []
    missing: list[str] = []

    def _substitute(match: re.Match[str]) -> str:
        name = match.group(1)
        value = context.get(name)
        cleaned = sanitize_value(value) if value is not None else ""
        if not cleaned:
            if name in fallbacks:
                used_fallbacks.append(name)
                return sanitize_value(fallbacks[name])
            missing.append(name)
            return ""
        used.append(name)
        return cleaned

    parse_variables(body)
    text = _PLACEHOLDER.sub(_substitute, body).strip()
    if missing:
        raise TemplateRenderError("No value or fallback for variable(s): " + ", ".join(sorted(set(missing))))
    if not text:
        raise TemplateRenderError("Rendered message is empty.")
    if template_type is not None and len(text) > MAX_LENGTH[template_type]:
        raise TemplateRenderError(f"Rendered message exceeds {MAX_LENGTH[template_type]} characters.")
    return RenderResult(text, tuple(dict.fromkeys(used)), tuple(dict.fromkeys(used_fallbacks)))
