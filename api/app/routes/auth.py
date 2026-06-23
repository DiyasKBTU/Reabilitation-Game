from fastapi import APIRouter, HTTPException, status
from beanie import PydanticObjectId
from ..models.user import User
from ..models.patient import Patient
from ..auth.password import hash_password, verify_password
from ..auth.jwt import create_token
from ..auth.deps import get_current_user
from ..schemas.auth import RegisterIn, LoginIn, TokenOut, UserOut
from fastapi import Depends

router = APIRouter(prefix="/auth", tags=["auth"])


def _user_out(user: User) -> UserOut:
    return UserOut(id=str(user.id), username=user.username, email=user.email, role=user.role)


@router.post("/register", response_model=TokenOut, status_code=201)
async def register(body: RegisterIn):
    # Публичная регистрация — ТОЛЬКО пациент. Роли doctor/admin создаёт админ (или сид-скрипт):
    # так пациент не может сам стать врачом и не выбирает/не прикрепляет себе врача при регистрации.
    # Врач прикрепляет пациента к себе сам (POST /patients/{id}/attach).
    if not body.consent:
        raise HTTPException(400, "Требуется согласие на обработку персональных данных")
    if await User.find_one(User.username == body.username):
        raise HTTPException(400, "Имя пользователя занято")
    if await User.find_one(User.email == body.email):
        raise HTTPException(400, "Email уже зарегистрирован")

    user = User(
        username=body.username,
        email=body.email,
        password_hash=hash_password(body.password),
        role="patient",          # принудительно: публично регистрируется только пациент
        consent=body.consent,
    )
    await user.insert()

    # Карточка пациента создаётся БЕЗ врача (doctor_id=None) — «неприкреплённый».
    # Врач увидит его в списке неприкреплённых и прикрепит к себе.
    patient = Patient(user_id=user.id, full_name=body.username)
    await patient.insert()

    token = create_token(str(user.id), user.role)
    return TokenOut(access_token=token, user=_user_out(user))


@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn):
    user = await User.find_one(User.username == body.username)
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(401, "Неверный логин или пароль")
    token = create_token(str(user.id), user.role)
    return TokenOut(access_token=token, user=_user_out(user))


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return _user_out(user)
