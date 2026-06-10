from fastapi import APIRouter, Depends, HTTPException
from beanie import PydanticObjectId
from ..models.user import User
from ..models.patient import Patient
from ..auth.deps import get_current_user, require_doctor
from ..schemas.patient import PatientOut, PatientCreate, PatientUpdate
from typing import List

router = APIRouter(prefix="/patients", tags=["patients"])


def _out(p: Patient) -> PatientOut:
    return PatientOut(
        id=str(p.id),
        full_name=p.full_name,
        diagnosis=p.diagnosis,
        age=p.age,
        gender=p.gender,
        user_id=str(p.user_id) if p.user_id else None,
        doctor_id=str(p.doctor_id) if p.doctor_id else None,
        created_at=p.created_at,
    )


@router.get("", response_model=List[PatientOut])
async def list_patients(user: User = Depends(get_current_user)):
    if user.role == "admin":
        patients = await Patient.find().to_list()
    elif user.role == "doctor":
        patients = await Patient.find(Patient.doctor_id == user.id).to_list()
    else:
        p = await Patient.find_one(Patient.user_id == user.id)
        patients = [p] if p else []
    return [_out(p) for p in patients]


@router.post("", response_model=PatientOut, status_code=201)
async def create_patient(body: PatientCreate, user: User = Depends(require_doctor)):
    patient = Patient(
        full_name=body.full_name,
        diagnosis=body.diagnosis,
        age=body.age,
        gender=body.gender,
        user_id=PydanticObjectId(body.user_id) if body.user_id else None,
        doctor_id=user.id if user.role == "doctor" else None,
    )
    await patient.insert()
    return _out(patient)


@router.get("/{pid}", response_model=PatientOut)
async def get_patient(pid: str, user: User = Depends(get_current_user)):
    p = await Patient.get(PydanticObjectId(pid))
    if not p:
        raise HTTPException(404, "Пациент не найден")
    if user.role == "patient" and p.user_id != user.id:
        raise HTTPException(403, "Нет доступа")
    return _out(p)


@router.patch("/{pid}", response_model=PatientOut)
async def update_patient(pid: str, body: PatientUpdate, user: User = Depends(require_doctor)):
    p = await Patient.get(PydanticObjectId(pid))
    if not p:
        raise HTTPException(404, "Пациент не найден")
    update_data = body.model_dump(exclude_none=True)
    if update_data:
        await p.set(update_data)
    return _out(p)
