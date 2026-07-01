from fastapi import APIRouter, Depends, HTTPException, Query
from beanie import PydanticObjectId
from typing import List, Optional
from datetime import datetime, timezone
from ..models.user import User
from ..models.patient import Patient
from ..models.session import Session
from ..models.score import Score
from ..auth.deps import get_current_user, verify_patient_access
from ..schemas.session import SessionCreate, SessionLabelIn, SessionOut
from ..ml.features import extract_features
from ..ml.games import axis_for_game, secondary_axes_for_game
from ..ml.validity import mark_validity, is_analyzable
from ..calibration import ensure_baseline, set_baseline_from_session

router = APIRouter(prefix="/sessions", tags=["sessions"])


def _secondary_features(series, game_type: str):
    """Признаки по вторичным осям игры (multi-axis). None, если их нет или ряд пуст.

    mark_validity снимает `valid` у осей без реального движения (напр. пациент почти не
    пользовался газом/тормозом → pitch ROM≈0): такая ось не попадёт в baseline и вердикт.
    """
    axes = secondary_axes_for_game(game_type)
    if not series or not axes:
        return None
    return {axis: mark_validity(extract_features(series, axis)) for axis in axes}


def _out(s: Session) -> SessionOut:
    return SessionOut(
        id=str(s.id),
        patient_id=str(s.patient_id),
        game_type=s.game_type,
        game_name=s.game_name,
        score=s.score,
        max_combo=s.max_combo,
        zone_hits=s.zone_hits,
        duration_sec=s.duration_sec,
        level=s.level,
        features=s.features,
        performance=s.performance,
        label=s.label,
        is_calibration=s.is_calibration,
        created_at=s.created_at,
    )


@router.post("", response_model=SessionOut, status_code=201)
async def create_session(body: SessionCreate, user: User = Depends(get_current_user)):
    if body.patient_id:
        # IDOR-гард: создавать сессию можно только своему пациенту (врач — своему, пациент — себе).
        patient = await verify_patient_access(body.patient_id, user)
        patient_id = patient.id
    elif user.role == "patient":
        patient = await Patient.find_one(Patient.user_id == user.id)
        if not patient:
            raise HTTPException(404, "Профиль пациента не найден")
        patient_id = patient.id
    else:
        raise HTTPException(400, "Укажите patient_id")

    axis = axis_for_game(body.game_type)
    # mark_validity снимает features.valid у «пустых прогонов» (машина/платформа разбилась
    # без управления → ROM≈0): сырой ряд сохраняем, но из аналитики такую сессию исключаем.
    features = mark_validity(extract_features(body.imu_time_series, axis)) if body.imu_time_series else None
    axis_features = _secondary_features(body.imu_time_series, body.game_type)

    session = Session(
        patient_id=patient_id,
        doctor_id=user.id if user.role == "doctor" else None,
        game_type=body.game_type,
        game_name=body.game_name,
        score=body.score,
        max_combo=body.max_combo,
        zone_hits=body.zone_hits,
        duration_sec=body.duration_sec,
        level=body.level,
        imu_time_series=body.imu_time_series,
        features=features,
        axis_features=axis_features,
        calibration=body.calibration,
        performance=body.performance,
    )
    await session.insert()

    sc = Score(patient_id=patient_id, username=user.username,
               game_type=body.game_type, score=body.score)
    await sc.insert()

    # Калибровка. Явная (направляемая, body.is_calibration) → эта сессия ПЕРЕЗАПИСЫВАет baseline
    # (поддержка ре-калибровки, напр. после смены датчика). Иначе — пассивная: первая пригодная
    # сессия в игре становится калибровочной (ensure_baseline идемпотентна).
    if features and is_analyzable(features):
        if body.is_calibration:
            await set_baseline_from_session(patient, session)  # сам выставит is_calibration
        else:
            baseline = await ensure_baseline(patient, body.game_type)
            if baseline and baseline.get("session_id") == str(session.id):
                session.is_calibration = True

    return _out(session)


@router.get("", response_model=List[SessionOut])
async def list_sessions(
    patient_id: Optional[str] = Query(None),
    game_type: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    user: User = Depends(get_current_user),
):
    query = {}
    if patient_id:
        await verify_patient_access(patient_id, user)   # IDOR-гард: только свой пациент
        query["patient_id"] = PydanticObjectId(patient_id)
    elif user.role == "patient":
        patient = await Patient.find_one(Patient.user_id == user.id)
        if not patient:
            return []
        query["patient_id"] = patient.id
    if game_type:
        query["game_type"] = game_type

    sessions = (
        await Session.find(query)
        .sort("-created_at")
        .limit(limit)
        .to_list()
    )
    return [_out(s) for s in sessions]


@router.get("/calibration/status")
async def calibration_status(
    game_type: str = Query("game1"),
    patient_id: Optional[str] = Query(None),
    user: User = Depends(get_current_user),
):
    """Откалиброван ли пациент в этой игре (есть ли персональный baseline).

    Фронт показывает пациенту онбординг «первая сессия — калибровочная», пока
    calibrated=false. Путь /calibration/status (два сегмента) не конфликтует с /{sid}.
    """
    if patient_id:
        patient = await verify_patient_access(patient_id, user)   # IDOR-гард + загрузка
    elif user.role == "patient":
        patient = await Patient.find_one(Patient.user_id == user.id)
    else:
        raise HTTPException(400, "Укажите patient_id")
    if not patient:
        raise HTTPException(404, "Профиль пациента не найден")

    baseline = await ensure_baseline(patient, game_type)
    return {"game_type": game_type, "calibrated": baseline is not None, "baseline": baseline}


@router.get("/{sid}", response_model=SessionOut)
async def get_session(sid: str, user: User = Depends(get_current_user)):
    s = await Session.get(PydanticObjectId(sid))
    if not s:
        raise HTTPException(404, "Сессия не найдена")
    await verify_patient_access(s.patient_id, user)   # IDOR-гард: сессия чужого пациента недоступна
    return _out(s)


@router.get("/{sid}/trace")
async def session_trace(sid: str, max_points: int = Query(150, le=600),
                        user: User = Depends(get_current_user)):
    """Сырой ряд движения сессии (угол во времени) для графика траектории — доказывает,
    что данные настоящие. Равномерный даунсэмпл до max_points, чтобы ответ оставался лёгким.
    Путь /{sid}/trace (два сегмента) не конфликтует с /{sid}."""
    s = await Session.get(PydanticObjectId(sid))
    if not s:
        raise HTTPException(404, "Сессия не найдена")
    await verify_patient_access(s.patient_id, user)   # IDOR-гард

    series = s.imu_time_series or []
    n = len(series)
    if n > max_points:
        step = n / max_points
        series = [series[int(i * step)] for i in range(max_points)]
    dur = s.duration_sec or 0
    m = len(series)
    # x в секундах: если ряд большой — раскладываем равномерно по длительности (единицы t у
    # разных источников отличаются), иначе сохраняем относительный порядок.
    pts = [{
        "t": round(i / (m - 1) * dur, 2) if m > 1 and dur else i,
        "r": round(float(x.get("r", 0)), 2),
        "p": round(float(x.get("p", 0)), 2),
    } for i, x in enumerate(series)]
    return {"game_type": s.game_type, "is_calibration": s.is_calibration,
            "duration_sec": dur, "count": n, "points": pts}


@router.patch("/{sid}/label", response_model=SessionOut)
async def label_session(sid: str, body: SessionLabelIn, user: User = Depends(get_current_user)):
    s = await Session.get(PydanticObjectId(sid))
    if not s:
        raise HTTPException(404, "Сессия не найдена")
    await verify_patient_access(s.patient_id, user)   # IDOR-гард: метку ставит только владелец

    label = dict(s.label or {})
    label["labeled_at"] = datetime.now(timezone.utc).isoformat()

    if user.role == "patient":
        if body.pain is not None:
            label["pain"] = body.pain
        if body.fatigue is not None:
            label["fatigue"] = body.fatigue
    else:
        if body.pain is not None:
            label["pain"] = body.pain
        if body.fatigue is not None:
            label["fatigue"] = body.fatigue
        if body.quality is not None:
            label["quality"] = body.quality

    await s.set({"label": label})
    return _out(s)
