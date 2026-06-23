"""
Оркестратор аномалий по нескольким управляющим осям (multi-axis игры).

`extract_features` и модель аномалий axis-agnostic — считают один и тот же 16-мерный вектор по
любой оси. Здесь детектор (`detect_anomalies`) прогоняется по КАЖДОЙ управляемой оси игры
(City Driver: руль = roll + газ/тормоз = pitch) и вердикты агрегируются в один общий:

  - статус        = худший из осей (critical > attention > normal > …);
  - anomalyScore  = максимум по осям;
  - текст/режим   = берутся у «ведущей» оси (той, что дала худший вердикт), чтобы note/mode
                    соответствовали статусу;
  - флаги         = объединение по осям, каждый помечен осью (axis/axisLabel).

Так врач видит, КАКАЯ ось отклонилась, а общий вердикт не теряет аномалию ни по одной оси.
Для одноосевой игры (Space Catcher) результат идентичен прежнему `detect_anomalies` — обратная
совместимость поля `anomaly` в ответе `/insights`.
"""
from __future__ import annotations
from typing import Dict, List, Any, Tuple

from .anomaly import detect_anomalies

# Порядок «тяжести» статуса для выбора худшего/ведущего вердикта.
_STATUS_RANK = {
    "no_data": 0,
    "insufficient_baseline": 1,
    "normal": 2,
    "attention": 3,
    "critical": 4,
}


def analyze_axes(
    axes: List[Tuple[str, str]],
    current_by_axis: Dict[str, Dict[str, Any]],
    history_by_axis: Dict[str, List[Dict[str, Any]]],
) -> Dict[str, Any]:
    """
    axes            — [(ось, подпись), ...]; первая считается основной.
    current_by_axis — {ось: признаки текущей сессии}.
    history_by_axis — {ось: [признаки прошлых сессий, от старых к новым]}.

    Возвращает {"overall": <анализ>, "axes": {ось: {"label", "anomaly"}}}.
    `overall` совместим по форме с `detect_anomalies` (status, anomalyScore, flags, …).
    """
    per_axis: Dict[str, Any] = {}
    for ax, label in axes:
        cur = current_by_axis.get(ax)
        if not cur:
            continue
        res = detect_anomalies(cur, history_by_axis.get(ax) or [])
        per_axis[ax] = {"label": label, "anomaly": res}

    return {"overall": _aggregate(axes, per_axis), "axes": per_axis}


def _aggregate(axes: List[Tuple[str, str]], per_axis: Dict[str, Any]) -> Dict[str, Any]:
    """Сводит пер-осевые вердикты в один. Ведущая ось = худший статус, затем больший счёт."""
    if not per_axis:
        return {"status": "no_data", "flags": [], "anomalyScore": 0,
                "baselineSize": 0, "mode": "none", "note": "Нет признаков текущей сессии"}

    multi = len(per_axis) > 1
    order = [ax for ax, _ in axes if ax in per_axis]  # порядок осей (основная первой)
    label_of = {ax: label for ax, label in axes}

    def _key(ax: str):
        a = per_axis[ax]["anomaly"]
        return (_STATUS_RANK.get(a.get("status"), 0), a.get("anomalyScore", 0) or 0)

    # Ведущая ось: максимум по (статус, счёт); при равенстве — раньше в порядке осей (основная).
    lead_ax = max(order, key=lambda ax: (_key(ax), -order.index(ax)))
    overall = dict(per_axis[lead_ax]["anomaly"])  # копия — не мутируем пер-осевой результат

    # anomalyScore — максимум по всем осям; флаги — объединение с пометкой оси.
    overall["anomalyScore"] = max((per_axis[ax]["anomaly"].get("anomalyScore", 0) or 0)
                                  for ax in order)
    flags: List[Dict[str, Any]] = []
    for ax in order:
        for fl in (per_axis[ax]["anomaly"].get("flags") or []):
            fl2 = dict(fl)
            if multi:
                fl2["axis"] = ax
                fl2["axisLabel"] = label_of.get(ax, ax)
            flags.append(fl2)
    overall["flags"] = flags

    if multi:
        overall["axesAnalyzed"] = order
        overall["leadAxis"] = lead_ax
        # Если вердикт дала НЕ основная ось — добавим её в note, чтобы текст совпадал со статусом.
        if lead_ax != order[0] and overall.get("status") in ("attention", "critical"):
            overall["note"] = f'{overall.get("note", "")} (ось: {label_of.get(lead_ax, lead_ax)})'.strip()
    return overall
