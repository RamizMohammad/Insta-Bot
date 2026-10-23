from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import ForeignKey, Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, JSONType, Timestamps, UUIDPrimaryKey, str_enum
from app.models.enums import CampaignStatus, GroupOperator, MatchType, OperatingMode, RuleAction


class Campaign(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "campaigns"
    __table_args__ = (
        # Hot path: "active campaigns targeting this media".
        Index("ix_campaigns_media_status", "media_external_id", "status"),
        Index("ix_campaigns_workspace_created", "workspace_id", "created_at"),
    )

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    connection_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("instagram_connections.id", ondelete="SET NULL"))
    media_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("instagram_media.id", ondelete="SET NULL"))
    # External (Instagram) media ID the campaign listens on; also used by simulation mode.
    media_external_id: Mapped[str | None] = mapped_column(String(64))
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[CampaignStatus] = mapped_column(str_enum(CampaignStatus), default=CampaignStatus.DRAFT)
    mode: Mapped[OperatingMode] = mapped_column(str_enum(OperatingMode), default=OperatingMode.SIMULATION)
    config: Mapped[dict[str, Any]] = mapped_column(JSONType, default=dict)

    rules: Mapped[list[TriggerRule]] = relationship(
        back_populates="campaign",
        cascade="all, delete-orphan",
        passive_deletes=True,
        order_by="TriggerRule.position",
        lazy="selectin",
    )


class TriggerRule(UUIDPrimaryKey, Base):
    __tablename__ = "trigger_rules"

    campaign_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"), index=True)
    keyword: Mapped[str] = mapped_column(String(200))
    match_type: Mapped[MatchType] = mapped_column(str_enum(MatchType), default=MatchType.CONTAINS)
    case_sensitive: Mapped[bool] = mapped_column(default=False)
    action: Mapped[RuleAction] = mapped_column(str_enum(RuleAction), default=RuleAction.INCLUDE)
    group_key: Mapped[str] = mapped_column(String(64), default="default")
    group_operator: Mapped[GroupOperator] = mapped_column(str_enum(GroupOperator), default=GroupOperator.OR)
    position: Mapped[int] = mapped_column(default=0)

    campaign: Mapped[Campaign] = relationship(back_populates="rules")
