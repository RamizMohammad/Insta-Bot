from __future__ import annotations

from fastapi import APIRouter, Depends, status

from app.api.dependencies import AuthDep, CurrentUser, SessionDep, auth_rate_limit
from app.schemas.auth import LoginRequest, LogoutRequest, RefreshRequest, RegisterRequest, TokenPair, UserOut
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post(
    "/register",
    response_model=UserOut,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(auth_rate_limit("register"))],
)
async def register(body: RegisterRequest, session: SessionDep) -> UserOut:
    user = await AuthService(session).register(body.email, body.password, body.workspace_name)
    return UserOut.model_validate(user)


@router.post("/login", response_model=TokenPair, dependencies=[Depends(auth_rate_limit("login"))])
async def login(body: LoginRequest, session: SessionDep) -> TokenPair:
    return await AuthService(session).login(body.email, body.password)


@router.post("/refresh", response_model=TokenPair, dependencies=[Depends(auth_rate_limit("refresh"))])
async def refresh(body: RefreshRequest, session: SessionDep) -> TokenPair:
    return await AuthService(session).refresh(body.refresh_token)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(body: LogoutRequest, auth: AuthDep, session: SessionDep) -> None:
    await AuthService(session).logout(
        auth.user, refresh_token=body.refresh_token, all_sessions=body.all_sessions, access_claims=auth.claims
    )


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> UserOut:
    return UserOut.model_validate(user)
