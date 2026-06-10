from fastapi import APIRouter, Depends, HTTPException
from beanie import PydanticObjectId
from pydantic import BaseModel
from typing import Optional, List
from ..models.user import User
from ..models.patient import Patient
from ..auth.deps import require_admin

router = APIRouter(prefix="/admin", tags=["admin"])


class UserAdminUpdate(BaseModel):
    role: Optional[str] = None
    platform_access: Optional[bool] = None
    database_access: Optional[bool] = None


@router.get("/users")
async def list_users(admin: User = Depends(require_admin)):
    users = await User.find_all().to_list()
    result = []
    for u in users:
        patient = await Patient.find_one(Patient.user_id == u.id)
        result.append({
            "id": str(u.id),
            "username": u.username,
            "email": u.email,
            "role": u.role,
            "platform_access": u.platform_access,
            "database_access": u.database_access,
            "created_at": u.created_at.isoformat(),
            "patient_id": str(patient.id) if patient else None,
        })
    return result


@router.patch("/users/{uid}")
async def update_user(uid: str, body: UserAdminUpdate, admin: User = Depends(require_admin)):
    user = await User.get(PydanticObjectId(uid))
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    update_data = body.model_dump(exclude_none=True)
    if update_data:
        await user.set(update_data)
    return {"id": str(user.id), "username": user.username, "role": user.role}


@router.delete("/users/{uid}", status_code=204)
async def delete_user(uid: str, admin: User = Depends(require_admin)):
    user = await User.get(PydanticObjectId(uid))
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    await user.delete()
