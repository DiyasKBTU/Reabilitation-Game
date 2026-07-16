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


def _uid(value: str) -> PydanticObjectId:
    """Невалидный ObjectId → 404, а не 500."""
    try:
        return PydanticObjectId(value)
    except Exception:
        raise HTTPException(404, "Пользователь не найден")


@router.patch("/users/{uid}")
async def update_user(uid: str, body: UserAdminUpdate, admin: User = Depends(require_admin)):
    user = await User.get(_uid(uid))
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    update_data = body.model_dump(exclude_none=True)
    # Защита от самоблокировки: админ не может снять себе роль или доступ —
    # иначе одна ошибка в UI оставляет систему без администратора.
    if user.id == admin.id and (
        update_data.get("role") not in (None, "admin") or update_data.get("platform_access") is False
    ):
        raise HTTPException(400, "Нельзя заблокировать или понизить собственную учётку администратора")
    if update_data:
        await user.set(update_data)
    return {"id": str(user.id), "username": user.username, "role": user.role}


@router.delete("/users/{uid}", status_code=204)
async def delete_user(uid: str, admin: User = Depends(require_admin)):
    """Удалить учётку. Судьба данных зависит от типа пользователя:
    - тестовый (is_test) → каскад: карточка + сессии + очки (мусор не копим);
    - реальный пациент → удаляется ТОЛЬКО вход; карточка и сессии остаются
      (медицинские данные и ML-ряды ценны — вход можно завести заново по ИИН).
    """
    user = await User.get(_uid(uid))
    if not user:
        raise HTTPException(404, "Пользователь не найден")
    if user.id == admin.id:
        raise HTTPException(400, "Нельзя удалить собственную учётку администратора")
    patient = await Patient.find_one(Patient.user_id == user.id)
    if patient:
        if user.is_test or patient.is_test:
            await Session.find(Session.patient_id == patient.id).delete()
            await Score.find(Score.patient_id == patient.id).delete()
            await patient.delete()
        else:
            await patient.set({"user_id": None})   # карточка «осиротела», данные целы
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
    user = await User.get(_uid(uid))
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
    inv = await DoctorInvite.get(_uid(iid))
    if not inv:
        raise HTTPException(404, "Код не найден")
    await inv.delete()


# ─── Выгрузка обучающего датасета ────────────────────────────────────────────

@router.get("/export/ml-dataset")
async def export_ml_dataset(
    game_type: Optional[str] = None,
    include_series: bool = False,
    skip: int = 0,
    limit: int = 2000,
    admin: User = Depends(require_admin),
):
    """Датасет для обучения ML: сессии РЕАЛЬНЫХ пациентов, качественно отфильтрованные
    и связанные с контекстом пациента (диагноз, возраст, пол) и метками (боль/усталость/
    оценка врача). Один вызов — готовый материал для ml-service.

    Фильтры качества:
      - пациент не тестовый (is_test=False) и не демо;
      - источник входа — датчик (input_source ble/None), клавиатурные сессии исключены;
      - есть признаки движения (features), их валидность видна в поле features.valid.

    Личность пациента псевдонимизирована: вместо имени/ИИН — patient_key (стабильный хэш),
    по нему сессии одного ребёнка связываются между собой без раскрытия личности.
    include_series=true добавляет сырой ряд imu_time_series (ответ становится тяжёлым —
    выгружайте порциями через skip/limit).
    """
    import hashlib

    limit = max(1, min(limit, 5000))

    # Карточки реальных пациентов (не тест). $ne, а не ==False: у старых карточек поля
    # is_test может не быть вовсе. Демо-пациенты отсекаются по source.
    patients = await Patient.find({"is_test": {"$ne": True}}).to_list()
    real = {p.id: p for p in patients if p.source != "demo"}
    if not real:
        return {"count": 0, "rows": []}

    query: dict = {
        "patient_id": {"$in": list(real.keys())},
        # Датчик или старый клиент (None); синтетические клавиатурные ряды — вон.
        "input_source": {"$in": [None, "ble"]},
        "features": {"$ne": None},
    }
    if game_type:
        query["game_type"] = game_type

    # Прямой запрос с проекцией: не тащим тяжёлый сырой ряд в память, если он не нужен
    # (контейнер api живёт с mem_limit 300M).
    projection = None if include_series else {"imu_time_series": 0}
    cursor = (
        Session.get_motor_collection()
        .find(query, projection)
        .sort("created_at", 1)
        .skip(max(0, skip))
        .limit(limit)
    )

    rows = []
    async for doc in cursor:
        p = real.get(doc["patient_id"])
        if p is None:
            continue
        row = {
            "session_id": str(doc["_id"]),
            # Псевдоним: связывает сессии одного пациента, не раскрывая ИИН/имя.
            "patient_key": hashlib.sha256(str(doc["patient_id"]).encode()).hexdigest()[:12],
            "diagnosis": p.diagnosis,
            "age": p.age,
            "gender": p.gender,
            "game_type": doc.get("game_type"),
            "score": doc.get("score"),
            "duration_sec": doc.get("duration_sec"),
            "is_calibration": doc.get("is_calibration", False),
            "input_source": doc.get("input_source"),
            "source": doc.get("source"),           # None=живая запись, "firebase"=импорт
            "features": doc.get("features"),
            "axis_features": doc.get("axis_features"),
            "performance": doc.get("performance"),
            "label": doc.get("label"),             # боль/усталость пациента, оценка врача
            "created_at": doc["created_at"].isoformat() if doc.get("created_at") else None,
        }
        if include_series:
            row["imu_time_series"] = doc.get("imu_time_series") or []
        rows.append(row)

    return {
        "count": len(rows),
        "skip": skip,
        "limit": limit,
        "filters": {"game_type": game_type, "include_series": include_series,
                    "excluded": ["is_test-пациенты", "demo-пациенты", "клавиатурные сессии"]},
        "rows": rows,
    }


@router.get("/dataset-stats")
async def dataset_stats(admin: User = Depends(require_admin)):
    """Прогресс сбора обучающих данных — для панели «Сбор ML-данных» в админке.

    Показывает, сколько сессий реальных пациентов (не тест/не демо) пришло с датчика,
    сколько размечено пациентом (боль/усталость) и врачом (quality), и сколько уже
    готово к обучению. Счёт «норма/аномалия» повторяет правило разметки
    `ml-service/data/mongo_loader.label_from_session` (боль ≥1 или усталость ≥7 →
    аномалия; боль 0 и усталость ≤4 → норма; усталость 5–6 без боли — серая зона,
    в обучение не идёт). Только лёгкие count-запросы — сырой ряд в память не тянется
    (контейнер api живёт с mem_limit 300M).
    """
    patients = await Patient.find({"is_test": {"$ne": True}}).to_list()
    real_ids = [p.id for p in patients if p.source != "demo"]
    coll = Session.get_motor_collection()

    base = {"patient_id": {"$in": real_ids}}
    ble = {**base, "input_source": {"$in": [None, "ble"]}}
    valid = {**ble, "features.valid": True}
    has_any_label = {"$or": [{"label.pain": {"$exists": True}},
                             {"label.fatigue": {"$exists": True}}]}
    # Правило mongo_loader: отсутствующая боль считается 0, усталость 5–6 — серая зона.
    train_anomaly = {**valid, "$or": [{"label.pain": {"$gte": 1}},
                                      {"label.fatigue": {"$gte": 7}}]}
    train_normal = {**valid, "$and": [
        {"$or": [{"label.pain": 0}, {"label.pain": {"$exists": False}}]},
        {"$or": [{"label.fatigue": {"$exists": False}}, {"label.fatigue": {"$lte": 4}}]},
        has_any_label,
    ]}

    last = await coll.find(base, {"created_at": 1}).sort("created_at", -1).limit(1).to_list(1)

    return {
        "patients_real": len(real_ids),
        "sessions_total": await coll.count_documents(base),
        "sessions_ble": await coll.count_documents(ble),
        "sessions_valid": await coll.count_documents(valid),
        "labeled_by_patient": await coll.count_documents({**valid, **has_any_label}),
        "labeled_by_doctor": await coll.count_documents(
            {**valid, "label.quality": {"$exists": True}}),
        "train_normal": await coll.count_documents(train_normal),
        "train_anomaly": await coll.count_documents(train_anomaly),
        "last_session_at": (last[0]["created_at"].isoformat()
                            if last and last[0].get("created_at") else None),
    }
