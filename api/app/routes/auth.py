from fastapi import APIRouter, HTTPException, Request, status
from beanie import PydanticObjectId
from datetime import datetime, timezone
from ..models.user import User
from ..models.patient import Patient
from ..models.invite import DoctorInvite
from ..auth.password import hash_password, verify_password
from ..auth.jwt import create_token
from ..auth.deps import get_current_user
from ..auth.ratelimit import client_ip, check_login_allowed, register_failure, register_success
from ..schemas.auth import RegisterIn, RegisterDoctorIn, LoginIn, TokenOut, UserOut
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

    # Логин пациента — ИИН (12 цифр). username — запасной вариант при отсутствии ИИН.
    iin = (body.iin or "").strip()
    if iin:
        if not (iin.isdigit() and len(iin) == 12):
            raise HTTPException(400, "ИИН должен состоять из 12 цифр")
        username = iin
    elif (body.username or "").strip():
        username = body.username.strip()
    else:
        raise HTTPException(400, "Укажите ИИН")

    if await User.find_one(User.username == username):
        raise HTTPException(400, "Пациент с таким ИИН уже зарегистрирован" if iin
                                 else "Имя пользователя занято")

    # email необязателен (у ребёнка может не быть) → синтезируем уникальный из логина.
    email = (str(body.email) if body.email else "").strip() or f"{username}@patient.local"
    if await User.find_one(User.email == email):
        raise HTTPException(400, "Email уже зарегистрирован")

    user = User(
        username=username,
        email=email,
        password_hash=hash_password(body.password),
        role="patient",          # принудительно: публично регистрируется только пациент
        consent=body.consent,
    )
    await user.insert()

    # Карточка пациента создаётся БЕЗ врача (doctor_id=None) — «неприкреплённый».
    # Врач увидит его в списке неприкреплённых и прикрепит к себе. Медданные (имя, диагноз,
    # возраст, пол) — с формы регистрации; пациент может отредактировать их позже в профиле.
    patient = Patient(
        user_id=user.id,
        iin=iin or None,
        full_name=(body.full_name or "").strip() or username,
        diagnosis=(body.diagnosis or "").strip() or None,
        age=body.age,
        gender=(body.gender or "").strip() or None,
    )
    await patient.insert()

    token = create_token(str(user.id), user.role)
    return TokenOut(access_token=token, user=_user_out(user))


@router.post("/register-doctor", response_model=TokenOut, status_code=201)
async def register_doctor(body: RegisterDoctorIn):
    # Регистрация врача (B2B) — только по одноразовому коду от администратора/центра.
    # Без валидного кода роль doctor получить нельзя; пациент карточку себе тут не заводит.
    if not body.consent:
        raise HTTPException(400, "Требуется согласие на обработку персональных данных")

    invite = await DoctorInvite.find_one(DoctorInvite.code == body.invite_code.strip())
    if not invite:
        raise HTTPException(400, "Неверный код приглашения")
    if invite.used_by is not None:
        raise HTTPException(409, "Код приглашения уже использован")

    if await User.find_one(User.username == body.username):
        raise HTTPException(400, "Имя пользователя занято")
    if await User.find_one(User.email == body.email):
        raise HTTPException(400, "Email уже зарегистрирован")

    user = User(
        username=body.username,
        email=body.email,
        password_hash=hash_password(body.password),
        role="doctor",
        consent=body.consent,
    )
    await user.insert()

    # Помечаем код использованным (одноразовый).
    await invite.set({"used_by": user.id, "used_at": datetime.now(timezone.utc)})

    token = create_token(str(user.id), user.role)
    return TokenOut(access_token=token, user=_user_out(user))


@router.post("/login", response_model=TokenOut)
async def login(body: LoginIn, request: Request):
    # Анти-brute-force: ИИН предсказуем, ПИН короткий — без лимита пара перебирается.
    ip = client_ip(request)
    check_login_allowed(body.username, ip)
    user = await User.find_one(User.username == body.username)
    if not user or not verify_password(body.password, user.password_hash):
        register_failure(body.username, ip)
        raise HTTPException(401, "Неверный логин или пароль")
    register_success(body.username)
    token = create_token(str(user.id), user.role)
    return TokenOut(access_token=token, user=_user_out(user))


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return _user_out(user)
