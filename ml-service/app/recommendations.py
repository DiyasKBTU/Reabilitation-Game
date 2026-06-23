"""
ML — Движок рекомендаций по слабой стороне пациента (Python-зеркало).

Эталон логики — backend/services/recommendationService.js. Контракт ответа
идентичен (docs/ML_CONTRACT.md). Сейчас правила; в будущем сюда подключается
персонализация на обученной модели, не меняя интерфейс ответа.

Поддержка решения врача, НЕ диагноз.
"""
from __future__ import annotations
from typing import List, Dict, Any, Optional, Callable

T = {
    "SYMMETRY_ATTENTION": 0.20, "SYMMETRY_CRITICAL": 0.40,
    "ROM_LOW": 30, "ROM_CRITICAL": 15, "SMOOTHNESS_LOW": 0.6,
    "TREMOR_HIGH": 0.4, "TREMOR_POWER_HIGH": 0.03, "PAUSE_HIGH": 0.5, "ENDURANCE_LOW": 40,
    "PEAKVEL_LOW": 40, "REPS_LOW": 15,
}


def _num(v, d=0.0):
    return float(v) if isinstance(v, (int, float)) else d


def _r1(v): return round(v * 10) / 10
def _r2(v): return round(v * 100) / 100
def _mean(a): return sum(a) / len(a) if a else 0.0
def _sev_rank(s): return {"critical": 3, "attention": 2, "info": 1}.get(s, 0)


def detect_weak_side(f: Dict[str, Any]) -> Dict[str, Any]:
    """Слабая сторона = асимметрия достижимого ДИАПАЗОНА (|maxAngle| vs |minAngle|).

    symmetryIndex для колебательного движения ≈ 0 и слабую сторону не ловит —
    её ловит асимметрия диапазона. Подробности — в одноимённой JS-функции.
    """
    min_a = _num(f.get("minAngle"))
    max_a = _num(f.get("maxAngle"))
    sym = _num(f.get("symmetryIndex"))

    pos_mag = max(max_a, 0.0)
    neg_mag = max(-min_a, 0.0)
    total = pos_mag + neg_mag
    range_asym = (pos_mag - neg_mag) / total if total > 0 else 0.0
    abs_asym = abs(range_asym)

    direction, severity = "none", "info"
    label = "Выраженной асимметрии диапазона не выявлено"
    evidence = f"диапазон: −{_r1(neg_mag)}°..+{_r1(pos_mag)}° (симметрично)"

    if abs_asym >= T["SYMMETRY_ATTENTION"]:
        direction = "negative" if range_asym > 0 else "positive"
        strong = "«плюс» (один наклон)" if range_asym > 0 else "«минус» (другой наклон)"
        weak = "«минус» (другой наклон)" if range_asym > 0 else "«плюс» (один наклон)"
        severity = "critical" if abs_asym >= T["SYMMETRY_CRITICAL"] else "attention"
        label = f"Слабое направление: {weak}. Диапазон в сторону {strong} заметно больше."
        evidence = (f"диапазон −{_r1(neg_mag)}°..+{_r1(pos_mag)}° → асимметрия "
                    f"{round(abs_asym * 100)}% в пользу {strong} (symmetryIndex = {_r2(sym)})")

    return {"detected": direction != "none", "direction": direction, "severity": severity,
            "asymmetryPct": round(abs_asym * 100), "rangeAsym": _r2(range_asym),
            "label": label, "evidence": evidence}


def _rom_target(current: float, base: Optional[float]) -> int:
    by_pct = current * 1.2
    return round(max(by_pct, base or 0, 35))


def _metric_item(id, key, severity, priority, label, current, base, finding, recommendation, unit):
    return {"id": id, "area": "rom", "severity": severity, "priority": priority,
            "targetMetric": key, "current": _r1(current),
            "baseline": _r1(base) if base is not None else None, "unit": unit,
            "finding": f"{label}: {finding}", "recommendation": recommendation}


def _top_action(items: List[Dict[str, Any]]) -> str:
    if not items:
        return "Особых действий не требуется."
    top = sorted(items, key=lambda a: (a["priority"], -_sev_rank(a["severity"])))[0]
    return top["recommendation"].split(".")[0] + "."


def _session_plan(f, baseline, weak_side, anomaly):
    rom = _num(f.get("rom"))
    rom_base = baseline("rom")
    sm = _num(f.get("smoothnessIndex"))
    status = anomaly.get("status")
    # Частичные признаки (агрегаты Firebase): плавность недоступна (sm=0), поэтому не
    # принимаем по ней решений. Консервативно: hold, и decrease только если детектор
    # отметил critical. Иначе sm=0 ложно дало бы вечный "decrease"/"качество > очков".
    partial = bool(f.get("partial"))
    level = "hold"
    if partial:
        level = "decrease" if status == "critical" else "hold"
    elif status == "critical" or sm < 0.4:
        level = "decrease"
    elif sm >= 0.7 and status in (None, "normal"):
        level = "increase"
    return {"levelAdvice": level, "targetRomDeg": _rom_target(rom, rom_base),
            "suggestedDurationSec": 60 if status == "critical" else 120,
            "weakSideExtraRepsPct": (20 if weak_side["severity"] == "critical" else 10) if weak_side["detected"] else 0,
            "emphasizeQualityOverScore": (False if partial else sm < T["SMOOTHNESS_LOW"])}


def build_recommendations(features: Dict[str, Any], history: Optional[List[Dict]] = None,
                          anomaly: Optional[Dict] = None, trends: Optional[Dict] = None) -> Dict[str, Any]:
    f = features or {}
    history = [h for h in (history or []) if h and h.get("valid") is not False]
    anomaly = anomaly or {}
    trends = trends or {}

    if not f or f.get("valid") is False:
        return {"version": "1.0", "weakSide": detect_weak_side({}),
                "focus": "Недостаточно данных для рекомендаций (нет признаков текущей сессии).",
                "items": [], "sessionPlan": None, "note": "Поддержка решения врача, не диагноз."}

    def baseline(key: str) -> Optional[float]:
        return _mean([_num(h.get(key)) for h in history]) if history else None

    weak = detect_weak_side(f)
    items: List[Dict[str, Any]] = []

    if anomaly.get("status") == "critical":
        items.append({"id": "anomaly_critical", "area": "safety", "severity": "critical", "priority": 1,
                      "finding": "Детектор отметил сильное отклонение от личной нормы пациента (возможна боль/усталость).",
                      "recommendation": "Снизить нагрузку в этой сессии, сделать паузу/отдых. Уточнить у пациента боль и самочувствие, при сохранении сигналов — очный осмотр.",
                      "flags": [x.get("text") for x in anomaly.get("flags", [])]})
    elif anomaly.get("status") == "attention":
        items.append({"id": "anomaly_attention", "area": "safety", "severity": "attention", "priority": 2,
                      "finding": "Лёгкое отклонение от личной нормы — стоит понаблюдать.",
                      "recommendation": "Не повышать сложность в ближайших сессиях, отслеживать динамику.",
                      "flags": [x.get("text") for x in anomaly.get("flags", [])]})

    if weak["detected"]:
        extra = 20 if weak["severity"] == "critical" else 10
        items.append({"id": "weak_side", "area": "asymmetry", "severity": weak["severity"], "priority": 3,
                      "targetMetric": "rangeAsymmetry", "current": weak["rangeAsym"], "target": 0,
                      "finding": f'Асимметрия движения ~{weak["asymmetryPct"]}%. {weak["label"]}',
                      "recommendation": (f"Делать акцент на слабом направлении: +{extra}% повторов в слабую сторону, "
                                         "симметричные «зеркальные» упражнения здоровой стороной как образец темпа и амплитуды. "
                                         "Контролировать, чтобы экскурсия в слабую сторону росла от сессии к сессии."),
                      "evidence": weak["evidence"]})

    rom = _num(f.get("rom"))
    rom_base = baseline("rom")
    if rom < T["ROM_CRITICAL"]:
        items.append(_metric_item("rom_low", "rom", "critical", 3, "Амплитуда (ROM)", rom, rom_base,
                                   "Критически малая амплитуда движения.",
                                   f"Начать с пассивно-активной разработки в комфортном диапазоне, цель — постепенно довести ROM до {_rom_target(rom, rom_base)}°. Без боли, по 1–2° за сессию.", "°"))
    elif rom < T["ROM_LOW"] or (rom_base and rom < rom_base * 0.85):
        items.append(_metric_item("rom_low", "rom", "attention", 4, "Амплитуда (ROM)", rom, rom_base,
                                   "Сниженная амплитуда движения.",
                                   f"Увеличить целевой угол в игре, цель ~{_rom_target(rom, rom_base)}°. Тянуться до края диапазона без боли.", "°"))

    sm = _num(f.get("smoothnessIndex"))
    if 0 < sm < T["SMOOTHNESS_LOW"]:
        items.append({"id": "smoothness_low", "area": "coordination",
                      "severity": "critical" if sm < 0.4 else "attention", "priority": 5,
                      "targetMetric": "smoothnessIndex", "current": _r2(sm), "target": 0.7,
                      "finding": f"Движения рывковые (плавность {_r2(sm)} из 1.0).",
                      "recommendation": "Снизить уровень/скорость игры, делать медленные контролируемые повторы. Сделать упор на качество траектории, а не на скорость и очки."})

    tr = _num(f.get("tremorIndex"))
    tr_power = _num(f.get("tremorPower"))
    tr_freq = _num(f.get("tremorFreqHz"))
    if tr > T["TREMOR_HIGH"] or tr_power > T["TREMOR_POWER_HIGH"]:
        # Частотный анализ (FFT) уточняет паттерн: 4–6 Гц — ближе к тремору покоя.
        evidence = None
        if tr_freq > 0:
            evidence = (f"частотный анализ: доминирующая частота ~{_r1(tr_freq)} Гц, "
                        f"{round(tr_power * 100)}% мощности движения в полосе дрожи (3–12 Гц)")
        items.append({"id": "tremor_high", "area": "neuro",
                      "severity": "critical" if (tr > 0.65 or tr_power > 0.05) else "attention", "priority": 5,
                      "targetMetric": "tremorIndex", "current": _r2(tr), "target": 0.3,
                      "finding": f"Заметное дрожание (тремор {_r2(tr)} из 1.0).",
                      "recommendation": "Короткие сессии с опорой предплечья/локтя на стол для стабилизации. Добавить отдых между подходами; при нарастании — отметить для невролога.",
                      "evidence": evidence})

    pr = _num(f.get("pauseRatio"))
    if pr > T["PAUSE_HIGH"]:
        items.append({"id": "pause_high", "area": "endurance", "severity": "attention", "priority": 6,
                      "targetMetric": "pauseRatio", "current": _r2(pr), "target": 0.3,
                      "finding": f"Много пауз в движении ({round(pr * 100)}% времени без активности).",
                      "recommendation": "Интервальный режим: короче по времени, но чаще. Поддерживать непрерывный темп в коротких блоках, отдыхать между ними."})

    endur = _num(f.get("activeTimeSec"))
    if 0 < endur < T["ENDURANCE_LOW"]:
        items.append({"id": "endurance_low", "area": "endurance", "severity": "attention", "priority": 6,
                      "targetMetric": "activeTimeSec", "current": _r1(endur), "target": T["ENDURANCE_LOW"],
                      "finding": f"Малое активное время ({_r1(endur)} с за сессию).",
                      "recommendation": "Постепенно увеличивать длительность активной фазы (+10–15% в неделю), не доводя до утомления."})

    pv = _num(f.get("peakVelocity"))
    if 0 < pv < T["PEAKVEL_LOW"]:
        items.append({"id": "velocity_low", "area": "strength", "severity": "info", "priority": 7,
                      "targetMetric": "peakVelocity", "current": _r1(pv), "target": T["PEAKVEL_LOW"],
                      "finding": f"Невысокая скорость движений (пик {_r1(pv)} °/с).",
                      "recommendation": "Когда амплитуда и плавность стабильны — добавить упражнения на скорость в безопасном диапазоне (короткие быстрые повторы)."})

    if trends.get("rom", {}).get("direction") == "down":
        items.append({"id": "trend_rom_down", "area": "trend", "severity": "attention", "priority": 4,
                      "targetMetric": "rom",
                      "finding": f'Амплитуда снижается от сессии к сессии (наклон {_r2(_num(trends["rom"].get("slope")))}).',
                      "recommendation": "Проверить причину спада (боль, усталость, мотивация). Временно снизить целевую нагрузку и пересмотреть план."})
    if trends.get("score", {}).get("direction") == "down":
        items.append({"id": "trend_score_down", "area": "trend", "severity": "info", "priority": 8,
                      "finding": f'Игровой результат снижается (наклон {_r2(_num(trends["score"].get("slope")))}).',
                      "recommendation": "Возможна усталость или потеря интереса — обсудить с пациентом, при необходимости сменить игру/уровень."})

    if not items:
        items.append({"id": "all_good", "area": "progress", "severity": "info", "priority": 9,
                      "finding": "Показатели в пределах личной нормы, выраженных слабых сторон не выявлено.",
                      "recommendation": "Можно аккуратно повысить сложность/целевую амплитуду на 5–10% и поддерживать регулярность занятий."})

    items.sort(key=lambda a: (a["priority"], -_sev_rank(a["severity"])))

    return {
        "version": "1.0", "weakSide": weak,
        "focus": (f'Фокус: слабое направление (асимметрия ~{weak["asymmetryPct"]}%). {_top_action(items)}'
                  if weak["detected"] else _top_action(items)),
        "items": items, "sessionPlan": _session_plan(f, baseline, weak, anomaly),
        "note": "Поддержка решения врача, не диагноз. Рекомендации основаны на признаках движения и личной норме пациента.",
    }
