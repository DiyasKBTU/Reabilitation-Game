from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from beanie import PydanticObjectId
from .jwt import decode_token
from ..models.user import User
from ..models.patient import Patient

_bearer = HTTPBearer(auto_error=False)


async def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> User:
    if not creds:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Требуется авторизация")
    payload = decode_token(creds.credentials)
    if not payload or "sub" not in payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Недействительный токен")
    user = await User.get(PydanticObjectId(payload["sub"]))
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Пользователь не найден")
    return user


async def require_doctor(user: User = Depends(get_current_user)) -> User:
    if user.role not in ("doctor", "admin"):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Требуется роль врача")
    return user


async def require_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Требуется роль администратора")
    return user


async def verify_patient_access(patient_id, user: User) -> Patient:
    """Загружает пациента и проверяет право доступа текущего пользователя.

    Правила владения (защита от чтения чужих медданных по ID, IDOR):
      - admin  → любой пациент;
      - doctor → только свои (`patient.doctor_id == user.id`);
      - patient→ только своя карточка (`patient.user_id == user.id`).

    Поднимает 404, если пациента нет, и 403, если доступа нет. Возвращает объект Patient,
    чтобы вызывающий код не загружал его повторно.
    """
    p = await Patient.get(PydanticObjectId(str(patient_id)))
    if not p:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Пациент не найден")
    if user.role == "admin":
        return p
    if user.role == "doctor":
        if p.doctor_id != user.id:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа к этому пациенту")
        return p
    if p.user_id != user.id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа")
    return p
