"""
Сквозной тест новых гардов качества данных и приватности (аудит 2026-07-11).

Проверяет через настоящие роуты FastAPI (fake-Mongo: mongomock-motor):
  1. Сессия с датчика (input_source="ble") → baseline создаётся, очки в рейтинг пишутся.
  2. Клавиатурная сессия → сохраняется, но baseline НЕ создаётся и в рейтинг НЕ попадает.
  3. Клавиатурная «калибровка» (is_calibration=true) НЕ перезаписывает baseline.
  4. /leaderboard не светит username (ИИН): чужие видят псевдоним, своя строка — is_me.
  5. /admin/export/ml-dataset отдаёт только датчиковые сессии с псевдонимом patient_key.
  6. Rate-limit входа: после MAX_PER_USER неудач — 429.
  7. platform_access=False реально блокирует доступ (403).

Запуск: venv\\Scripts\\python.exe -m pytest api/tests/ -v  (Mongo не нужна).
"""
import asyncio
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from mongomock_motor import AsyncMongoMockClient
from beanie import init_beanie

from app.main import app
from app.models.user import User
from app.models.patient import Patient
from app.models.session import Session
from app.models.score import Score
from app.models.invite import DoctorInvite
from app.auth import ratelimit
from app.auth.password import hash_password


def _series(n=100, amp=30.0):
    """Ряд IMU с реальным движением: rom>=5°, сэмплов>=10, длительность>=3с (см. validity.py)."""
    import math
    return [{"t": i * 40, "r": amp * math.sin(i / 6), "p": 0.0, "y": 0.0} for i in range(n)]


@pytest_asyncio.fixture()
async def client():
    db = AsyncMongoMockClient()["testdb"]
    await init_beanie(database=db, document_models=[User, Patient, Session, Score, DoctorInvite])
    ratelimit._fails.clear()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def _register_patient(client, iin, name):
    r = await client.post("/api/auth/register", json={
        "iin": iin, "password": "pin123", "consent": True, "full_name": name,
    })
    assert r.status_code == 201, r.text
    tok = r.json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


@pytest.mark.asyncio
async def test_ble_session_creates_baseline_and_score(client):
    h = await _register_patient(client, "111111111111", "Ребёнок Один")
    r = await client.post("/api/sessions", headers=h, json={
        "score": 50, "duration_sec": 30, "game_type": "game1",
        "imu_time_series": _series(), "input_source": "ble",
    })
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["input_source"] == "ble"
    assert body["is_calibration"] is True          # первая пригодная сессия = точка отсчёта

    st = await client.get("/api/sessions/calibration/status?game_type=game1", headers=h)
    assert st.json()["calibrated"] is True

    lb = await client.get("/api/leaderboard?game_type=game1", headers=h)
    assert any(row["is_me"] for row in lb.json())  # очки записаны


@pytest.mark.asyncio
async def test_keyboard_session_never_becomes_baseline_or_score(client):
    h = await _register_patient(client, "222222222222", "Ребёнок Два")
    # Обычная клавиатурная игра
    r = await client.post("/api/sessions", headers=h, json={
        "score": 999, "duration_sec": 30, "game_type": "game1",
        "imu_time_series": _series(), "input_source": "keyboard",
    })
    assert r.status_code == 201
    assert r.json()["is_calibration"] is False

    # Клавиатурная «калибровка» тоже не должна стать baseline
    r2 = await client.post("/api/sessions", headers=h, json={
        "score": 0, "duration_sec": 20, "game_type": "game1", "is_calibration": True,
        "imu_time_series": _series(), "input_source": "keyboard",
    })
    assert r2.status_code == 201

    st = await client.get("/api/sessions/calibration/status?game_type=game1", headers=h)
    assert st.json()["calibrated"] is False        # синтетика точкой отсчёта не стала

    lb = await client.get("/api/leaderboard?game_type=game1", headers=h)
    assert all(not row["is_me"] for row in lb.json())   # очков за клавиатуру нет


@pytest.mark.asyncio
async def test_leaderboard_hides_other_patients_identity(client):
    h1 = await _register_patient(client, "333333333333", "Айсулу")
    h2 = await _register_patient(client, "444444444444", "Бекзат")
    for h in (h1, h2):
        await client.post("/api/sessions", headers=h, json={
            "score": 10, "duration_sec": 30, "game_type": "game1",
            "imu_time_series": _series(), "input_source": "ble",
        })
    rows = (await client.get("/api/leaderboard?game_type=game1", headers=h1)).json()
    assert len(rows) == 2
    mine = [r for r in rows if r["is_me"]]
    others = [r for r in rows if not r["is_me"]]
    assert mine and mine[0]["display_name"] == "Айсулу"
    # Чужая строка: ни ИИН, ни имени; patient_id пациенту не отдаётся
    assert others and "4444" not in others[0]["display_name"].replace("····", "")
    assert others[0]["display_name"].startswith("Игрок")
    assert "patient_id" not in others[0]
    assert "username" not in others[0]


@pytest.mark.asyncio
async def test_leaderboard_not_crowded_out_by_test_seeds(client):
    """Регрессия (найдено в UX-пассе 2026-07-15): тестовые пациенты с высокими очками
    заполняли окно выборки limit*2 целиком, и реальный игрок в рейтинг не попадал вовсе.
    Фильтр тестовых должен стоять ДО limit."""
    h = await _register_patient(client, "666666666666", "Реальный Игрок")
    await client.post("/api/sessions", headers=h, json={
        "score": 42, "duration_sec": 30, "game_type": "game1",
        "imu_time_series": _series(), "input_source": "ble",
    })
    # 50 тест-сидов с очками ВЫШЕ реального игрока (эмуляция seed_test_data).
    for i in range(50):
        tp = Patient(full_name=f"Тест {i}", is_test=True)
        await tp.insert()
        await Score(patient_id=tp.id, username=f"test{i}",
                    game_type="game1", score=1000 + i).insert()

    rows = (await client.get("/api/leaderboard?game_type=game1", headers=h)).json()
    assert len(rows) == 1                      # тест-сиды не показываются
    assert rows[0]["is_me"] is True
    assert rows[0]["score"] == 42              # реальный игрок не вытеснен из окна выборки


@pytest.mark.asyncio
async def test_admin_export_excludes_keyboard_and_pseudonymizes(client):
    admin = User(username="root", email="root@x.kz", password_hash=hash_password("adminpwd"),
                 role="admin")
    await admin.insert()
    ha = {"Authorization": (await client.post("/api/auth/login", json={
        "username": "root", "password": "adminpwd"})).json()["access_token"]}
    ha = {"Authorization": f"Bearer {ha['Authorization']}"}

    h = await _register_patient(client, "555555555555", "Дана")
    await client.post("/api/sessions", headers=h, json={
        "score": 5, "duration_sec": 30, "game_type": "game1",
        "imu_time_series": _series(), "input_source": "ble",
    })
    await client.post("/api/sessions", headers=h, json={
        "score": 6, "duration_sec": 30, "game_type": "game1",
        "imu_time_series": _series(), "input_source": "keyboard",
    })

    r = await client.get("/api/admin/export/ml-dataset", headers=ha)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["count"] == 1                      # клавиатурная сессия исключена
    row = data["rows"][0]
    assert row["input_source"] == "ble"
    assert "imu_time_series" not in row            # без include_series ряд не тащим
    assert "555555555555" not in str(row)          # ИИН нигде не светится
    assert len(row["patient_key"]) == 12


@pytest.mark.asyncio
async def test_login_rate_limit(client):
    await _register_patient(client, "666666666666", "Санжар")
    for _ in range(ratelimit.MAX_PER_USER):
        r = await client.post("/api/auth/login",
                              json={"username": "666666666666", "password": "wrong"})
        assert r.status_code == 401
    r = await client.post("/api/auth/login",
                          json={"username": "666666666666", "password": "wrong"})
    assert r.status_code == 429                    # перебор остановлен


@pytest.mark.asyncio
async def test_platform_access_blocks_user(client):
    h = await _register_patient(client, "777777777777", "Тимур")
    user = await User.find_one(User.username == "777777777777")
    await user.set({"platform_access": False})
    r = await client.get("/api/auth/me", headers=h)
    assert r.status_code == 403                    # тумблер админа реально блокирует
