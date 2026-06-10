from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from ..models.user import User
from ..auth.deps import get_current_user

router = APIRouter(prefix="/profile", tags=["profile"])


class ProfileUpdate(BaseModel):
    email: Optional[str] = None


@router.get("")
async def get_profile(user: User = Depends(get_current_user)):
    return {
        "id": str(user.id),
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "created_at": user.created_at.isoformat(),
    }


@router.patch("")
async def update_profile(body: ProfileUpdate, user: User = Depends(get_current_user)):
    update_data = body.model_dump(exclude_none=True)
    if update_data:
        await user.set(update_data)
    return {
        "id": str(user.id),
        "username": user.username,
        "email": user.email,
        "role": user.role,
    }
