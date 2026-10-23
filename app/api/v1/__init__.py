from fastapi import APIRouter

from app.api.v1 import (
    analytics,
    auth,
    campaigns,
    dev,
    executions,
    health,
    instagram,
    leads,
    templates,
    users,
    webhooks,
    workflows,
    workspaces,
)

api_router = APIRouter()
for module in (
    auth,
    users,
    workspaces,
    instagram,
    campaigns,
    analytics,
    templates,
    workflows,
    webhooks,
    executions,
    leads,
    dev,
    health,
):
    api_router.include_router(module.router)
