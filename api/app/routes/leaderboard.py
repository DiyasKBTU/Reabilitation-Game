from fastapi import APIRouter, Depends, Query
from ..models.score import Score
from ..models.user import User
from ..models.patient import Patient
from ..auth.deps import get_current_user

router = APIRouter(prefix="/leaderboard", tags=["leaderboard"])


@router.get("")
async def get_leaderboard(
    game_type: str = Query("game1"),
    limit: int = Query(20, le=100),
    user: User = Depends(get_current_user),
):
    """Рейтинг по игре — с защитой персональных данных.

    Раньше отдавался Score.username, а логин пациента = ИИН ребёнка → любой вошедший
    видел ИИН всех остальных. Теперь имя резолвится по карточке пациента с учётом роли:
      - своя запись → своё имя + is_me=true (подсветка «это вы»);
      - врач → имена ТОЛЬКО своих пациентов, admin → все;
      - остальные → псевдоним «Игрок ····XXXX» (без ИИН и без чужих имён).
    Тестовые карточки (is_test) в рейтинг не попадают; patient_id отдаётся только врачу/админу.
    """
    # Тестовые карточки отсекаются ДО limit. Раньше фильтр стоял после «limit*2 с запасом» —
    # на базе, где верх рейтинга занят тест-сидами, окно выборки заполнялось целиком ими,
    # и реальные игроки не попадали в рейтинг вовсе (пустая таблица при живых очках).
    test_ids = [p.id for p in await Patient.find({"is_test": True}).to_list()]
    scores = (
        await Score.find({"game_type": game_type, "patient_id": {"$nin": test_ids}})
        .sort("-score")
        .limit(limit * 2)   # небольшой запас: строки без карточки пациента пропускаются ниже
        .to_list()
    )

    # Пакетная загрузка карточек (не по одной на строку).
    pids = list({s.patient_id for s in scores})
    patients = await Patient.find({"_id": {"$in": pids}}).to_list() if pids else []
    by_id = {p.id: p for p in patients}

    my_patient = await Patient.find_one(Patient.user_id == user.id) if user.role == "patient" else None
    privileged = user.role in ("doctor", "admin")

    result = []
    for s in scores:
        p = by_id.get(s.patient_id)
        if p and p.is_test:
            continue   # защита в глубину: тестовые уже отсеяны запросом выше
        is_me = my_patient is not None and s.patient_id == my_patient.id
        if is_me:
            name = p.full_name if p else s.username
        elif user.role == "admin" or (user.role == "doctor" and p and p.doctor_id == user.id):
            name = p.full_name if p else s.username
        else:
            name = f"Игрок ····{str(s.patient_id)[-4:]}"
        row = {
            "rank": len(result) + 1,
            "display_name": name,
            "is_me": is_me,
            "score": s.score,
            "created_at": s.created_at.isoformat(),
        }
        if privileged:
            row["patient_id"] = str(s.patient_id)
        result.append(row)
        if len(result) >= limit:
            break
    return result
