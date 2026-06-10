"""
ML — клиническое заключение (narrative) поверх УЖЕ ПОСЧИТАННЫХ метрик.

ПРИНЦИП (см. docs/ML_SPEC.md §3.4): LLM, если включён, ТОЛЬКО перефразирует
посчитанные числа в текст. Запрещено вводить новые числа/диагнозы. Всегда есть
детерминированный шаблонный fallback — работает без ключа и без сети.

Провайдер абстрагирован: none (шаблон) | openai | claude. Управляется через .env:
  LLM_ENABLED, LLM_PROVIDER, LLM_MODEL, LLM_API_KEY, LLM_TIMEOUT_SEC.

HTTP — на stdlib urllib (без новых зависимостей). При любой ошибке/таймауте → шаблон.
"""
from __future__ import annotations
import json
import logging
import urllib.request
from typing import Dict, Any, Optional

from ..config import settings

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "Ты — ассистент врача-реабилитолога. На входе — УЖЕ ПОСЧИТАННЫЕ числовые показатели "
    "движения кисти пациента (амплитуда ROM, плавность, тремор, паузы и т.д.), статус "
    "отклонения от личной нормы и тренды. Сформулируй краткое клиническое заключение на "
    "русском: 2–4 предложения + до 3 конкретных действий. СТРОГО ЗАПРЕЩЕНО: вводить новые "
    "числа, диагнозы или утверждения, которых нет во входных данных; ставить диагноз. "
    "Это поддержка решения врача, не диагноз. Если данных мало — прямо скажи об этом."
)

_FEATURE_KEYS = ["rom", "peakVelocity", "smoothnessIndex", "tremorIndex",
                 "pauseRatio", "repetitions", "activeTimeSec", "symmetryIndex"]


def _grounding_payload(features, anomaly, recommendations, trends) -> Dict[str, Any]:
    """Строго ограниченный вход для LLM — только посчитанные значения."""
    f = features or {}
    a = anomaly or {}
    r = recommendations or {}
    partial = bool(f.get("partial"))
    # На частичных данных (агрегаты Firebase) реален только ROM; остальные признаки = 0 ещё
    # НЕ измерены — обнуляем в None, чтобы LLM не процитировал ложные нули как факт.
    feat = {k: (f.get(k) if (not partial or k == "rom") else None) for k in _FEATURE_KEYS}
    return {
        "features": feat,
        "dataQuality": ("partial_rom_only" if partial else "full"),
        "anomaly": {
            "status": a.get("status"),
            "score": a.get("anomalyScore"),
            "flags": [fl.get("text") for fl in a.get("flags", [])],
        },
        "weakSide": r.get("weakSide"),
        "topRecommendations": [it.get("recommendation") for it in r.get("items", [])[:3]],
        "trends": trends or {},
    }


def _template_narrative(features, anomaly, recommendations, trends) -> str:
    """Детерминированное заключение из чисел (fallback и режим по умолчанию)."""
    f = features or {}
    a = anomaly or {}
    r = recommendations or {}
    if not f or f.get("valid") is False:
        return "Недостаточно данных движения для заключения по этой сессии."

    parts = []
    partial = bool(f.get("partial"))
    rom, sm, tr = f.get("rom"), f.get("smoothnessIndex"), f.get("tremorIndex")
    head = f"Последняя сессия: амплитуда (ROM) {rom}°"
    if partial:
        # Частичные данные (агрегаты Firebase): плавность/тремор НЕ измерены (нет сырого ряда).
        # Не сообщаем их как 0 — иначе ложное «рывковые движения / нет тремора».
        head += " (оценка по амплитуде: сырой ряд движения не записан)"
    else:
        if sm is not None:
            head += f", плавность {round(sm * 100)}%"
        if tr is not None:
            head += f", тремор {round(tr * 100)}%"
    parts.append(head + ".")

    status_txt = {
        "critical": "детектор отметил выраженное отклонение от личной нормы (возможна боль/усталость)",
        "attention": "детектор отметил лёгкое отклонение от личной нормы",
        "normal": "показатели в пределах личной нормы пациента",
    }.get(a.get("status"))
    if status_txt:
        parts.append(status_txt[0].upper() + status_txt[1:] + ".")

    flags = [fl.get("text") for fl in a.get("flags", []) if fl.get("text")]
    if flags:
        parts.append("Ключевые отклонения: " + "; ".join(flags[:2]) + ".")

    ws = r.get("weakSide") or {}
    if ws.get("detected"):
        parts.append(f"Асимметрия ~{ws.get('asymmetryPct')}%: {ws.get('label')}")

    acts = [it.get("recommendation") for it in r.get("items", [])[:2] if it.get("recommendation")]
    if acts:
        parts.append("Рекомендации: " + " ".join(s.split(".")[0].strip() + "." for s in acts))

    parts.append("Поддержка решения врача, не диагноз.")
    return " ".join(parts)


def _http_post_json(url: str, headers: Dict[str, str], body: Dict[str, Any]) -> Dict[str, Any]:
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    with urllib.request.urlopen(req, timeout=settings.llm_timeout_sec) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _call_openai(payload: Dict[str, Any]) -> Optional[str]:
    out = _http_post_json(
        "https://api.openai.com/v1/chat/completions",
        {"Authorization": f"Bearer {settings.llm_api_key}", "Content-Type": "application/json"},
        {
            "model": settings.llm_model,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ],
            "temperature": 0.3,
            "max_tokens": 350,
        },
    )
    return out["choices"][0]["message"]["content"]


def _call_claude(payload: Dict[str, Any]) -> Optional[str]:
    out = _http_post_json(
        "https://api.anthropic.com/v1/messages",
        {"x-api-key": settings.llm_api_key, "anthropic-version": "2023-06-01", "Content-Type": "application/json"},
        {
            "model": settings.llm_model,
            "max_tokens": 350,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": json.dumps(payload, ensure_ascii=False)}],
        },
    )
    return out["content"][0]["text"]


def build_narrative(features, anomaly=None, recommendations=None, trends=None) -> Dict[str, Any]:
    """
    Возвращает {text, source, provider}.
      source: "template" (детерминированный) | "llm"
    Шаблон считается всегда — он же fallback, если LLM выключен/упал.
    """
    template = _template_narrative(features, anomaly, recommendations, trends)

    if not settings.llm_enabled or settings.llm_provider == "none" or not settings.llm_api_key:
        return {"text": template, "source": "template", "provider": "none"}

    payload = _grounding_payload(features, anomaly, recommendations, trends)
    try:
        if settings.llm_provider == "openai":
            txt = _call_openai(payload)
        elif settings.llm_provider == "claude":
            txt = _call_claude(payload)
        else:
            txt = None
        if txt and txt.strip():
            return {"text": txt.strip(), "source": "llm", "provider": settings.llm_provider}
    except Exception as e:
        logger.warning("LLM narrative failed (%s) — fallback на шаблон", e)

    return {"text": template, "source": "template", "provider": "none"}
