from __future__ import annotations

from fastapi import APIRouter, Depends, status

from app.api.dependencies import CurrentUser, SessionDep, auth_rate_limit
from app.schemas.auth import ChangePasswordRequest, UserOut
from app.services.auth_service import AuthService

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserOut)
async def get_me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)


@router.post(
    "/me/password",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(auth_rate_limit("password"))],
)
async def change_password(body: ChangePasswordRequest, user: CurrentUser, session: SessionDep) -> None:
    """Change password and revoke every refresh token for this user."""
    await AuthService(session).change_password(user, body.current_password, body.new_password)
