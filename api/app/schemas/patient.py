from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class PatientOut(BaseModel):
    id: str
    full_name: str
    diagnosis: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    iin: Optional[str] = None
    user_id: Optional[str] = None
    doctor_id: Optional[str] = None
    is_test: bool = False
    created_at: datetime
    # ПИН возвращается ТОЛЬКО в ответе на создание карты с входом (врач отдаёт родителю).
    # Нигде не хранится в открытом виде и в list/get всегда None.
    pin: Optional[str] = None


class PatientCreate(BaseModel):
    full_name: str
    diagnosis: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    user_id: Optional[str] = None
    # ИИН ребёнка (12 цифр). При create_login становится логином (User.username).
    iin: Optional[str] = None
    # Создать пациенту вход (играть самому): нужен iin; pin авто-генерируется, если не задан.
    create_login: bool = False
    pin: Optional[str] = None


class PatientUpdate(BaseModel):
    full_name: Optional[str] = None
    diagnosis: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
