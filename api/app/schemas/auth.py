from pydantic import BaseModel, EmailStr
from typing import Literal, Optional


class RegisterIn(BaseModel):
    # Публичная регистрация — только пациент, поэтому роль не принимается (см. routes/auth.py).
    # Логин пациента — ИИН (12 цифр): не забывается, есть в документах. username/email опциональны:
    # username — запасной логин при отсутствии ИИН (совместимость); email синтезируется, если не задан
    # (у ребёнка его может не быть). Хотя бы одно из iin/username должно быть указано.
    iin: Optional[str] = None
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    password: str
    consent: bool = False   # согласие на обработку персональных данных (обязательно при регистрации)
    # Медкарта пациента (коллекция patients, отдельно от учётки users). Все опциональны —
    # пациент может оставить диагноз пустым («уточнит врач»). full_name — настоящее имя ребёнка.
    full_name: Optional[str] = None
    diagnosis: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None


class RegisterDoctorIn(BaseModel):
    # Регистрация врача — только по коду-приглашению (его выдаёт администратор/центр).
    # Роль doctor проставляется сервером после проверки кода (см. routes/auth.py).
    username: str
    email: EmailStr
    password: str
    invite_code: str
    consent: bool = False


class LoginIn(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: str
    username: str
    email: str
    role: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut
