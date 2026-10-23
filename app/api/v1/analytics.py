from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from app.api.dependencies import SessionDep, WorkspaceDep
from app.schemas.analytics import Overview
from app.services.analytics_service import AnalyticsService

router = APIRouter(prefix="/analytics", tags=["analytics"])


@router.get("/overview", response_model=Overview)
async def overview(ctx: WorkspaceDep, session: SessionDep, days: Annotated[int, Query(ge=1, le=365)] = 30) -> Overview:
    """Dashboard metrics for the current workspace over the last ``days`` days."""
    return await AnalyticsService(session, ctx.workspace_id).overview(days)
