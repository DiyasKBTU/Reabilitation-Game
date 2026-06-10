from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class PatientOut(BaseModel):
    id: str
    full_name: str
    diagnosis: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    user_id: Optional[str] = None
    doctor_id: Optional[str] = None
    created_at: datetime


class PatientCreate(BaseModel):
    full_name: str
    diagnosis: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    user_id: Optional[str] = None


class PatientUpdate(BaseModel):
    full_name: Optional[str] = None
    diagnosis: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
