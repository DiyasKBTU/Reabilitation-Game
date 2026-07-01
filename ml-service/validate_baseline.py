"""
Валидация персонального z-score baseline (Слой 2) на РЕАЛЬНЫХ данных.

Зачем: реальных размеченных аномалий ДЦП открыто нет, но главный клинический механизм —
персональный baseline — НЕ требует чужих меток: он сравнивает сессию с личной историей
пациента. Этот скрипт честно проверяет его на реальных движениях (Mendeley, 154 сессии,
3 участника), без обученной модели.

Метод (leave-one-out по каждому участнику):
  - История = реальные сессии участника (его персональная норма).
  - Тест A (специфичность): отложенная РЕАЛЬНАЯ сессия → ожидаем «норма» (нет ложной тревоги).
  - Тест B (чувствительность): ту же сессию ДЕГРАДИРУЕМ на уровне сигнала (урезаем ROM +
    добавляем тремор — имитация боли/щажения/регресса) → ожидаем флаг.

Это проверяет ЛОГИКУ детектора на реальных персональных нормах. Деградация — синтетическая
(честно: реальных «плохих» сессий этих участников нет), но baseline и историю мы берём
полностью из реальных данных.

Запуск:  cd ml-service && ../venv/Scripts/python.exe validate_baseline.py
"""
from __future__ import annotations
import math
import os
import sys
from collections import defaultdict
from typing import List, Dict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from data.mendeley_loader import load_mendeley_dataset   # noqa: E402
from app.features import extract_features                 # noqa: E402
from app.anomaly import _predict_rule_based, MIN_BASELINE # noqa: E402


def degrade_signal(series: List[Dict], rom_factor: float = 0.4,
                   tremor_amp_deg: float = 4.0, tremor_hz: float = 5.0) -> List[Dict]:
    """Деградирует реальный сигнал: сжимает амплитуду вокруг среднего (↓ROM) + тремор.

    Имитирует «плохую» сессию того же пациента (боль/щажение + дрожание). Работает на
    сыром ряду, признаки потом считаются заново — честная проверка всего пайплайна.
    """
    rs = [pt["r"] for pt in series]
    m = sum(rs) / len(rs) if rs else 0.0
    out = []
    for pt in series:
        t_sec = pt["t"] / 1000.0
        r = m + (pt["r"] - m) * rom_factor                       # ↓ амплитуда
        r += tremor_amp_deg * math.sin(2 * math.pi * tremor_hz * t_sec)  # + тремор
        out.append({**pt, "r": round(r, 3)})
    return out


def _evaluate(groups: Dict[tuple, List[List[Dict]]]) -> tuple:
    """Leave-one-out по каждой группе → (специфичность%, чувствительность%, n_a, n_b)."""
    a_flagged = b_flagged = n = 0
    for _key, sess in groups.items():
        if len(sess) < MIN_BASELINE + 1:
            continue
        feats = [extract_features(s, "r") for s in sess]
        for i in range(len(sess)):
            history = [feats[j] for j in range(len(sess)) if j != i and feats[j].get("valid")]
            if len(history) < MIN_BASELINE:
                continue
            n += 1
            # Тест A: реальная отложенная сессия → ожидаем «норма» (нет ложной тревоги)
            if _predict_rule_based(feats[i], history)["status"] not in ("normal", "insufficient_baseline"):
                a_flagged += 1
            # Тест B: деградированная версия той же сессии → ожидаем флаг
            degraded = extract_features(degrade_signal(sess[i]), "r")
            if _predict_rule_based(degraded, history)["status"] in ("attention", "critical"):
                b_flagged += 1
    spec = 100 * (1 - a_flagged / n) if n else 0
    sens = 100 * b_flagged / n if n else 0
    return spec, sens, n, n


def _eval_policy(groups: Dict[tuple, List[List[Dict]]],
                 factors=(0.4, 0.7, 0.85)) -> tuple:
    """При ТЕКУЩИХ глобалях anomaly (пороги + REQUIRE_CORROBORATION) → (спец%, {factor: чувс%}).

    Тест A (специфичность): реальная отложенная сессия → не должна флагаться.
    Тест B (чувствительность): деградация той же сессии на РАЗНУЮ силу (0.4 сильная … 0.85 мягкая)
    → должна флагаться. Мягкая деградация — главный различитель политик.
    """
    a_flagged = n = 0
    b_flagged = {f: 0 for f in factors}
    for _key, sess in groups.items():
        if len(sess) < MIN_BASELINE + 1:
            continue
        feats = [extract_features(s, "r") for s in sess]
        for i in range(len(sess)):
            history = [feats[j] for j in range(len(sess)) if j != i and feats[j].get("valid")]
            if len(history) < MIN_BASELINE:
                continue
            n += 1
            if _predict_rule_based(feats[i], history)["status"] not in ("normal", "insufficient_baseline"):
                a_flagged += 1
            for fac in factors:
                degraded = extract_features(degrade_signal(sess[i], rom_factor=fac), "r")
                if _predict_rule_based(degraded, history)["status"] in ("attention", "critical"):
                    b_flagged[fac] += 1
    spec = 100 * (1 - a_flagged / n) if n else 0
    sens = {f: (100 * b_flagged[f] / n if n else 0) for f in factors}
    return spec, sens


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
    except Exception:
        pass

    series, _labels, stats = load_mendeley_dataset()
    uids = stats.get("uids_per_session", [])
    movetypes = stats.get("movetype_per_session", [])
    if not series or not uids:
        print("Нет реальных данных Mendeley. Скачайте датасет (см. mendeley_loader.py).")
        return

    print("=" * 72)
    print("Валидация персонального baseline (z-score, Слой 2) на РЕАЛЬНЫХ данных")
    print("=" * 72)
    print(f"Участники: {sorted(set(uids))} | всего сессий: {len(series)}\n")

    import app.anomaly as A
    A.REQUIRE_CORROBORATION = False  # секции ниже показывают СТАРОЕ поведение (любой флаг = тревога)

    # Подход 1: baseline по пациенту, СМЕШАВ все типы движений (наивно).
    by_user: Dict[tuple, List[List[Dict]]] = defaultdict(list)
    for s, uid in zip(series, uids):
        by_user[(uid,)].append(s)
    spec1, sens1, na1, _ = _evaluate(by_user)

    # Подход 2: baseline по (пациент + ТИП движения) — как в проде (одна игра = одно движение).
    by_user_move: Dict[tuple, List[List[Dict]]] = defaultdict(list)
    for s, uid, mt in zip(series, uids, movetypes):
        by_user_move[(uid, mt)].append(s)
    spec2, sens2, na2, _ = _evaluate(by_user_move)

    print(f"{'Подход (пороги по умолчанию 1.5σ/2.5σ)':<48}{'Специфич.':>11}{'Чувствит.':>11}")
    print("-" * 72)
    print(f"{'1. Baseline по пациенту (смешаны упражнения)':<48}{spec1:>10.1f}%{sens1:>10.1f}%")
    print(f"{'2. Baseline по (пациент + тип движения) ← прод':<48}{spec2:>10.1f}%{sens2:>10.1f}%")

    # ── Калибровка порогов на реальных данных (на прод-группировке) ──────────
    # _zscore_flags читает Z_WARNING/Z_CRITICAL из глобалей модуля при каждом вызове,
    # поэтому достаточно подменить их в app.anomaly и пере-оценить.
    A.REQUIRE_CORROBORATION = False
    print("\nКалибровка порогов z-score (группировка: пациент + тип движения):")
    print(f"{'  Z_warning / Z_critical':<48}{'Специфич.':>11}{'Чувствит.':>11}")
    print("-" * 72)
    best = None
    for z_warn, z_crit in [(1.5, 2.5), (2.0, 3.0), (2.5, 3.5), (3.0, 4.0), (3.5, 4.5)]:
        A.Z_WARNING, A.Z_CRITICAL = z_warn, z_crit
        spec, sens, _, _ = _evaluate(by_user_move)
        # «Хорошая» точка: специфичность ≥ 90% при максимальной чувствительности.
        mark = ""
        if spec >= 90 and (best is None or sens > best[2]):
            best = (z_warn, z_crit, sens, spec); mark = "  ← кандидат"
        print(f"{f'  {z_warn}σ / {z_crit}σ':<48}{spec:>10.1f}%{sens:>10.1f}%{mark}")
    A.Z_WARNING, A.Z_CRITICAL = 1.5, 2.5  # вернуть значения по умолчанию

    # ── Сравнение политик статуса: поправка на множественность vs подъём порога ──
    print("\nСравнение политик статуса (группировка: пациент + тип движения):")
    print(f"{'Политика':<42}{'Спец.':>8}{'×0.4':>7}{'×0.7':>7}{'×0.85':>7}")
    print(f"{'  (чувствит. по силе деградации →)':<42}{'':>8}{'сильн':>7}{'умер':>7}{'мягк':>7}")
    print("-" * 72)
    for name, cor, zw, zc in [
        ("A. любой флаг @1.5/2.5 (прод)",          False, 1.5, 2.5),
        ("B. >=2 метрик @1.5/2.5 (опция, off)",    True,  1.5, 2.5),
        ("C. любой флаг @3.0/4.0 (подъём порога)", False, 3.0, 4.0),
    ]:
        A.REQUIRE_CORROBORATION, A.Z_WARNING, A.Z_CRITICAL = cor, zw, zc
        spec, sens = _eval_policy(by_user_move)
        print(f"{name:<42}{spec:>7.0f}%{sens[0.4]:>6.0f}%{sens[0.7]:>6.0f}%{sens[0.85]:>6.0f}%")
    A.REQUIRE_CORROBORATION, A.Z_WARNING, A.Z_CRITICAL = False, 1.5, 2.5  # прод-дефолты

    print("-" * 72)
    print("\nВывод (честный, отрицательный по B):")
    print("• B (поправка на множественность) ≈ A: НЕ снижает ложные тревоги. Причина: тревоги на")
    print("  реальной норме — коррелированные многометричные (вариативность двигает ROM+скорость+")
    print("  плавность вместе), а не одиночный шум → подтверждение ≥2 метриками их не отсекает.")
    print("  Поэтому B в прод НЕ включён (нулевая польза = лишняя сложность).")
    print("• C (подъём порога) даёт спец. 92%, но теряет чувствительность к мягкому/умеренному")
    print("  регрессу (×0.85: 94→86, ×0.7: 97→88). Пороги НЕ поднимаем — популяция не та (здоровые).")
    print("• Бесплатного трюка для ложных тревог на этих данных нет. Реальный фикс — данные ДЦП")
    print("  или гейтинг качества сессии, а не порог/множественность. Прод: простой «любой флаг» @1.5σ.")


if __name__ == "__main__":
    main()
