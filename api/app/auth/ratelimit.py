"""
Защита входа от перебора (brute-force).

Зачем: логин пациента — ИИН (12 цифр, частично предсказуем: дата рождения + серия),
пароль ребёнку часто выдаётся как 6-значный ПИН. Без ограничителя пара ИИН+ПИН
перебирается за часы. Ограничиваем НЕУДАЧНЫЕ попытки: по логину (защита конкретной
учётки) и по IP (защита от массового перебора).

Реализация: чистая память процесса (прод — один uvicorn-воркер, см. api/Dockerfile),
без внешних зависимостей и Redis — сознательный выбор под VPS 1 ГБ. При рестарте
контейнера счётчики сбрасываются — это приемлемо: окно всего 15 минут.
"""
from __future__ import annotations
import time
from collections import deque
from typing import Deque, Dict

from fastapi import HTTPException, Request

WINDOW_SEC = 15 * 60   # окно подсчёта неудачных попыток
MAX_PER_USER = 8       # неудач на один логин в окно (легитимный пользователь столько не ошибается)
MAX_PER_IP = 30        # неудач с одного IP в окно (несколько учёток за одним NAT — с запасом)
_MAX_KEYS = 10_000     # предохранитель от разрастания словаря в памяти

_fails: Dict[str, Deque[float]] = {}


def client_ip(request: Request) -> str:
    """IP клиента. За nginx/Caddy настоящий адрес лежит в X-Forwarded-For (первый элемент)."""
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _prune(dq: Deque[float], now: float) -> None:
    while dq and now - dq[0] > WINDOW_SEC:
        dq.popleft()


def check_login_allowed(username: str, ip: str) -> None:
    """Поднимает 429, если по логину или IP уже исчерпан лимит неудачных попыток."""
    now = time.time()
    for key, limit in ((f"u:{username.strip().lower()}", MAX_PER_USER), (f"ip:{ip}", MAX_PER_IP)):
        dq = _fails.get(key)
        if dq is None:
            continue
        _prune(dq, now)
        if len(dq) >= limit:
            raise HTTPException(
                429, "Слишком много неудачных попыток входа. Подождите 15 минут и попробуйте снова."
            )


def register_failure(username: str, ip: str) -> None:
    """Зафиксировать неудачную попытку входа (неверный логин или пароль)."""
    now = time.time()
    if len(_fails) > _MAX_KEYS:   # аварийный сброс вместо неограниченного роста памяти
        _fails.clear()
    for key in (f"u:{username.strip().lower()}", f"ip:{ip}"):
        dq = _fails.setdefault(key, deque())
        _prune(dq, now)
        dq.append(now)


def register_success(username: str) -> None:
    """Успешный вход обнуляет счётчик логина (IP-счётчик оставляем — окно короткое)."""
    _fails.pop(f"u:{username.strip().lower()}", None)
