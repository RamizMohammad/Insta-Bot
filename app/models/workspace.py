from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, Timestamps, UUIDPrimaryKey, str_enum
from app.models.enums import WorkspaceRole

if TYPE_CHECKING:
    from app.models.user import User


class Workspace(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "workspaces"

    name: Mapped[str] = mapped_column(String(120))
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    # Explicitly authorised to use the simulation endpoint outside development.
    is_test_workspace: Mapped[bool] = mapped_column(default=False)

    members: Mapped[list[WorkspaceMember]] = relationship(
        back_populates="workspace", cascade="all, delete-orphan", passive_deletes=True
    )


class WorkspaceMember(UUIDPrimaryKey, Timestamps, Base):
    __tablename__ = "workspace_members"
    __table_args__ = (UniqueConstraint("workspace_id", "user_id"),)

    workspace_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("workspaces.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    role: Mapped[WorkspaceRole] = mapped_column(str_enum(WorkspaceRole), default=WorkspaceRole.MEMBER)

    workspace: Mapped[Workspace] = relationship(back_populates="members")
    user: Mapped[User] = relationship(back_populates="memberships")
