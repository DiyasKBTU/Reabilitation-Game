from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional
from ..models.user import User
from ..models.patient import Patient
from ..auth.deps import get_current_user

router = APIRouter(prefix="/profile", tags=["profile"])


class ProfileUpdate(BaseModel):
    email: Optional[str] = None
    # Медкарта пациента (коллекция patients). Только роль patient правит СВОЮ карту через профиль;
    # врач/admin эти поля не используют. Врач чужую карту правит через PATCH /patients/{id}.
    full_name: Optional[str] = None
    diagnosis: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None


async def _patient_of(user: User) -> Optional[Patient]:
    if user.role != "patient":
        return None
    return await Patient.find_one(Patient.user_id == user.id)


def _profile(user: User, patient: Optional[Patient]) -> dict:
    out = {
        "id": str(user.id),
        "username": user.username,
        "email": user.email,
        "role": user.role,
        "created_at": user.created_at.isoformat(),
    }
    if patient:
        out["patient"] = {
            "id": str(patient.id),
            "full_name": patient.full_name,
            "diagnosis": patient.diagnosis,
            "age": patient.age,
            "gender": patient.gender,
        }
    return out


@router.get("")
async def get_profile(user: User = Depends(get_current_user)):
    return _profile(user, await _patient_of(user))


@router.patch("")
async def update_profile(body: ProfileUpdate, user: User = Depends(get_current_user)):
    data = body.model_dump(exclude_none=True)
    if "email" in data:
        await user.set({"email": data["email"]})

    # Медданные → своя карта пациента (отдельная коллекция от учётки).
    patient = await _patient_of(user)
    if patient:
        card = {k: data[k] for k in ("full_name", "diagnosis", "age", "gender") if k in data}
        if card:
            await patient.set(card)
    return _profile(user, patient)
