"""Domain enumerations. Pure Python so the rule engine stays framework-independent."""

from enum import StrEnum


class UserStatus(StrEnum):
    ACTIVE = "active"
    DISABLED = "disabled"


class WorkspaceRole(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    MEMBER = "member"
    VIEWER = "viewer"


class ConnectionAuthMethod(StrEnum):
    INSTAGRAM_LOGIN = "instagram_login"
    MOCK = "mock"


class ConnectionStatus(StrEnum):
    ACTIVE = "active"
    EXPIRED = "expired"
    REVOKED = "revoked"
    ERROR = "error"


class CampaignStatus(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    PAUSED = "paused"
    STOPPED = "stopped"


class OperatingMode(StrEnum):
    SIMULATION = "simulation"
    LIVE = "live"


class MatchType(StrEnum):
    KEYWORD = "keyword"  # whole-word token match
    EXACT = "exact"  # entire comment equals the keyword
    PHRASE = "phrase"  # whole-word phrase match
    CONTAINS = "contains"  # substring match


class RuleAction(StrEnum):
    INCLUDE = "include"
    EXCLUDE = "exclude"


class GroupOperator(StrEnum):
    AND = "and"
    OR = "or"


class TemplateType(StrEnum):
    PUBLIC_REPLY = "public_reply"
    PRIVATE_REPLY = "private_reply"


class ActionType(StrEnum):
    PUBLIC_REPLY = "public_reply"
    PRIVATE_REPLY = "private_reply"


class EventSource(StrEnum):
    INSTAGRAM = "instagram"
    SIMULATION = "simulation"


class EventStatus(StrEnum):
    RECEIVED = "received"
    PROCESSING = "processing"
    PROCESSED = "processed"
    IGNORED = "ignored"
    FAILED = "failed"


class ExecutionStatus(StrEnum):
    QUEUED = "queued"
    IN_PROGRESS = "in_progress"
    RETRY_SCHEDULED = "retry_scheduled"
    SUCCEEDED = "succeeded"
    SIMULATED = "simulated"
    FAILED = "failed"
    UNKNOWN = "unknown"  # ambiguous outcome; never auto-retried
    SKIPPED = "skipped"
    MANUAL_REVIEW = "manual_review"
    CANCELLED = "cancelled"


TERMINAL_EXECUTION_STATUSES = frozenset(
    {
        ExecutionStatus.SUCCEEDED,
        ExecutionStatus.SIMULATED,
        ExecutionStatus.FAILED,
        ExecutionStatus.UNKNOWN,
        ExecutionStatus.SKIPPED,
        ExecutionStatus.MANUAL_REVIEW,
        ExecutionStatus.CANCELLED,
    }
)


class ErrorCategory(StrEnum):
    TRANSIENT = "transient"
    PERMANENT = "permanent"
    AMBIGUOUS = "ambiguous"
    RATE_LIMITED = "rate_limited"
    AUTHORIZATION = "authorization"
    UNSUPPORTED = "unsupported"
    VALIDATION = "validation"


class TriState(StrEnum):
    """An attribute that may be unavailable from the platform. Never inferred from missing data."""

    TRUE = "true"
    FALSE = "false"
    UNKNOWN = "unknown"


class FallbackBehavior(StrEnum):
    SKIP = "skip"
    MANUAL_REVIEW = "manual_review"
    PROCEED = "proceed"


class OutboxStatus(StrEnum):
    PENDING = "pending"
    DISPATCHED = "dispatched"


class FollowerRequirement(StrEnum):
    ANY = "any"
    FOLLOWERS_ONLY = "followers_only"
    NON_FOLLOWERS_ONLY = "non_followers_only"


class EligibilityDecision(StrEnum):
    PROCEED = "proceed"
    SKIP = "skip"
    MANUAL_REVIEW = "manual_review"
