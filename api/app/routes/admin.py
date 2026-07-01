import secrets
from fastapi import APIRouter, Depends, HTTPException
from beanie import PydanticObjectId
from pydantic import BaseModel
from typing import Optional, List
from ..models.user import User
from ..models.patient import Patient
from ..models.session import Session
from ..models.score import Score
from ..models.invite import DoctorInvite
from ..auth.deps import require_admin
from ..auth.password import hash_password

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
            "is_test": u.is_test,
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


class TestUserCreate(BaseModel):
    full_name: Optional[str] = None
    diagnosis: Optional[str] = None


@router.post("/test-users", status_code=201)
async def create_test_user(body: TestUserCreate, admin: User = Depends(require_admin)):
    """Создать тестового пациента (учётка + карта, флаг is_test) для проверки и игры.
    Возвращает логин и пароль — реальных пациентов не затрагивает (своя карта/patient_id)."""
    uname = "test_" + secrets.token_hex(3)
    pwd = secrets.token_urlsafe(6)
    user = User(username=uname, email=f"{uname}@test.local",
                password_hash=hash_password(pwd), role="patient", consent=True, is_test=True)
    await user.insert()
    patient = Patient(user_id=user.id, is_test=True,
                      full_name=(body.full_name or "").strip() or f"Тест {uname}",
                      diagnosis=(body.diagnosis or "").strip() or None)
    await patient.insert()
    return {"username": uname, "password": pwd, "user_id": str(user.id), "patient_id": str(patient.id)}


@router.delete("/test-users/{uid}", status_code=204)
async def delete_test_user(uid: str, admin: User = Depends(require_admin)):
    """Полностью удалить тестового пользователя: учётка + карта + сессии + очки.
    Только для is_test (реальных пациентов так не трогаем)."""
    user = await User.get(PydanticObjectId(uid))
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    if not user.is_test:
        raise HTTPException(400, "Это не тестовый пользователь")
    patient = await Patient.find_one(Patient.user_id == user.id)
    if patient:
        await Session.find(Session.patient_id == patient.id).delete()
        await Score.find(Score.patient_id == patient.id).delete()
        await patient.delete()
    await user.delete()


def _invite_out(inv: DoctorInvite) -> dict:
    return {
        "id": str(inv.id),
        "code": inv.code,
        "used": inv.used_by is not None,
        "used_by": str(inv.used_by) if inv.used_by else None,
        "used_at": inv.used_at.isoformat() if inv.used_at else None,
        "created_at": inv.created_at.isoformat(),
    }


@router.get("/doctor-invites")
async def list_doctor_invites(admin: User = Depends(require_admin)):
    """Список кодов-приглашений для регистрации врачей (B2B-онбординг)."""
    invites = await DoctorInvite.find_all().sort("-created_at").to_list()
    return [_invite_out(i) for i in invites]


@router.post("/doctor-invites", status_code=201)
async def create_doctor_invite(admin: User = Depends(require_admin)):
    """Сгенерировать одноразовый код для регистрации врача. Код отдаётся врачу,
    тот регистрируется через POST /auth/register-doctor."""
    code = secrets.token_urlsafe(9)
    invite = DoctorInvite(code=code, created_by=admin.id)
    await invite.insert()
    return _invite_out(invite)


@router.delete("/doctor-invites/{iid}", status_code=204)
async def delete_doctor_invite(iid: str, admin: User = Depends(require_admin)):
    inv = await DoctorInvite.get(PydanticObjectId(iid))
    if not inv:
        raise HTTPException(404, "Код не найден")
    await inv.delete()
