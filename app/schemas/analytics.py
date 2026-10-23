from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel


class ActionTotals(BaseModel):
    total: int = 0
    succeeded: int = 0
    simulated: int = 0
    failed: int = 0
    unknown: int = 0
    manual_review: int = 0
    skipped: int = 0
    pending: int = 0
    public_replies: int = 0
    private_replies: int = 0


class DailyPoint(BaseModel):
    date: date
    live: int
    simulated: int
    live_public: int = 0
    live_private: int = 0
    simulated_public: int = 0
    simulated_private: int = 0


class CampaignCounts(BaseModel):
    total: int
    active: int
    paused: int
    draft: int
    stopped: int


class CampaignExecutionStats(BaseModel):
    campaign_id: uuid.UUID
    total: int
    simulated: int
    live: int
    problems: int
    last_execution_at: datetime | None


class AttentionItem(BaseModel):
    kind: Literal["connection", "failures", "manual_review"]
    severity: Literal["critical", "warning", "info"]
    title: str
    detail: str
    campaign_id: uuid.UUID | None = None
    connection_id: uuid.UUID | None = None
    count: int = 0


class Overview(BaseModel):
    period_days: int
    comments_received: int
    comments_previous: int
    comments_matched: int
    last_event_at: datetime | None
    actions: ActionTotals
    success_rate: float | None
    daily: list[DailyPoint]
    campaigns: CampaignCounts
    campaign_stats: list[CampaignExecutionStats]
    attention: list[AttentionItem]
