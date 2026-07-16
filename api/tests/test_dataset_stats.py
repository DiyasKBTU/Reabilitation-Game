"""
Тест панели «Сбор ML-данных»: GET /admin/dataset-stats.

Счётчики должны повторять правило разметки обучения (mongo_loader.label_from_session):
  - боль >=1 или усталость >=7 → аномалия;
  - боль 0 и усталость <=4     → норма;
  - усталость 5–6 без боли     → серая зона (размечено, но в обучение не идёт);
клавиатурные сессии не считаются датчиковыми, оценка врача (quality) считается отдельно.

Запуск: venv\\Scripts\\python.exe -m pytest api/tests/ -v  (Mongo не нужна).
"""
import math
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
    """Ряд с реальным движением: rom>=5°, сэмплов>=10, длительность>=3с (см. validity.py)."""
    return [{"t": i * 40, "r": amp * math.sin(i / 6), "p": 0.0, "y": 0.0} for i in range(n)]


@pytest_asyncio.fixture()
async def client():
    db = AsyncMongoMockClient()["testdb"]
    await init_beanie(database=db, document_models=[User, Patient, Session, Score, DoctorInvite])
    ratelimit._fails.clear()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def _admin_headers(client):
    admin = User(username="root", email="root@x.kz",
                 password_hash=hash_password("adminpwd"), role="admin")
    await admin.insert()
    tok = (await client.post("/api/auth/login", json={
        "username": "root", "password": "adminpwd"})).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


async def _register_patient(client, iin, name):
    r = await client.post("/api/auth/register", json={
        "iin": iin, "password": "pin123", "consent": True, "full_name": name,
    })
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def _session(client, headers, **overrides):
    body = {"score": 10, "duration_sec": 30, "game_type": "game1",
            "imu_time_series": _series(), "input_source": "ble", **overrides}
    r = await client.post("/api/sessions", headers=headers, json=body)
    assert r.status_code == 201, r.text
    return r.json()


@pytest.mark.asyncio
async def test_dataset_stats_counters(client):
    ha = await _admin_headers(client)
    h = await _register_patient(client, "777777777777", "Аружан")

    # 1. Норма: боль 0, усталость 2.
    s1 = await _session(client, h)
    await client.patch(f"/api/sessions/{s1['id']}/label", headers=h,
                       json={"pain": 0, "fatigue": 2})
    # 2. Аномалия: сильная боль.
    s2 = await _session(client, h)
    await client.patch(f"/api/sessions/{s2['id']}/label", headers=h, json={"pain": 2})
    # 3. Серая зона: усталость 5 без боли — размечено, но в обучение не идёт.
    s3 = await _session(client, h)
    await client.patch(f"/api/sessions/{s3['id']}/label", headers=h, json={"fatigue": 5})
    # 4. Без метки.
    await _session(client, h)
    # 5. Клавиатурная — не датчиковая.
    await _session(client, h, input_source="keyboard")

    # Оценка врача (админ имеет доступ к любому пациенту) на сессии 1.
    r = await client.patch(f"/api/sessions/{s1['id']}/label", headers=ha, json={"quality": 4})
    assert r.status_code == 200, r.text
    assert r.json()["label"]["quality"] == 4

    r = await client.get("/api/admin/dataset-stats", headers=ha)
    assert r.status_code == 200, r.text
    st = r.json()

    assert st["patients_real"] == 1
    assert st["sessions_total"] == 5
    assert st["sessions_ble"] == 4          # клавиатурная не считается
    assert st["sessions_valid"] == 4
    assert st["labeled_by_patient"] == 3    # s1, s2, s3
    assert st["labeled_by_doctor"] == 1     # quality на s1
    assert st["train_normal"] == 1          # s1
    assert st["train_anomaly"] == 1         # s2 (s3 — серая зона)
    assert st["last_session_at"] is not None


@pytest.mark.asyncio
async def test_dataset_stats_requires_admin(client):
    h = await _register_patient(client, "888888888888", "Данияр")
    r = await client.get("/api/admin/dataset-stats", headers=h)
    assert r.status_code == 403
