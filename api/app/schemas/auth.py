from pydantic import BaseModel, EmailStr
from typing import Literal, Optional


class RegisterIn(BaseModel):
    username: str
    email: EmailStr
    password: str
    role: Literal["patient", "doctor", "admin"] = "patient"
    consent: bool = False   # согласие на обработку персональных данных (обязательно при регистрации)


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
