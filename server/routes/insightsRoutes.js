/**
 * GET /api/insights/:patientId
 *
 * Анализ сессий пациента по правилам:
 * — алерты по слабым метрикам
 * — тренды (линейная регрессия по последним сессиям)
 * — итоговый статус
 *
 * Данные берутся из существующих Session полей:
 * rangeOfMotion, strengthIndex, enduranceSec, movementCount,
 * score, maxCombo, zoneHits, durationSec
 */

const express = require("express");
const auth = require("../middleware/authMiddleware");
const dbAccess = require("../middleware/databaseAccessMiddleware");
const Session = require("../models/Session");
const Patient = require("../models/Patient");

const router = express.Router();

// ─── Линейная регрессия (slope) ────────────────────────────────────────────
function linearSlope(values) {
  const n = values.length;
  if (n < 2) return 0;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (values[i] - meanY);
    den += (i - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

function trendDirection(slope, threshold = 0.3) {
  if (slope > threshold)  return "up";
  if (slope < -threshold) return "down";
  return "stable";
}

// ─── Пороговые значения ────────────────────────────────────────────────────
const THRESHOLDS = {
  rom:           { critical: 10, warning: 20, unit: "°",  label: "Амплитуда движения (ROM)" },
  strength:      { critical: 0.2, warning: 0.4, unit: "", label: "Индекс силы движения" },
  endurance:     { critical: 20, warning: 60,  unit: "с", label: "Активное время движения" },
  movementCount: { critical: 15, warning: 35,  unit: "",  label: "Количество движений" },
  zoneHits:      { critical: 0, warning: 2,    unit: "",  label: "Направленные удары" }
};

function checkMetric(value, thresholds) {
  if (value < thresholds.critical) return "critical";
  if (value < thresholds.warning)  return "warning";
  return "good";
}

// ─── INSIGHTS ENDPOINT ─────────────────────────────────────────────────────
router.get("/:patientId", auth, dbAccess, async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.patientId);
    if (!patient) return res.status(404).json({ message: "Пациент табылмады" });

    if (
      req.currentUserDoc.role !== "admin" &&
      String(patient.doctorId) !== String(req.currentUserDoc._id)
    ) {
      return res.status(403).json({ message: "Бұл пациент сізге тиесілі емес" });
    }

    // Берём последние 10 сессий по дате
    const sessions = await Session
      .find({ patientId: req.params.patientId })
      .sort({ createdAt: 1 })
      .limit(10)
      .select("rangeOfMotion strengthIndex enduranceSec movementCount score maxCombo zoneHits durationSec createdAt gameType");

    if (!sessions.length) {
      return res.json({
        sessionCount: 0,
        alerts: [],
        trends: {},
        overallStatus: "no_data",
        summary: {}
      });
    }

    // ─── Средние значения ──────────────────────────────────────────────────
    const avg = (key) => {
      const vals = sessions.map(s => Number(s[key] || 0));
      return vals.reduce((a, b) => a + b, 0) / vals.length;
    };

    const avgROM       = avg("rangeOfMotion");
    const avgStrength  = avg("strengthIndex");
    const avgEndurance = avg("enduranceSec");
    const avgMoves     = avg("movementCount");
    const avgScore     = avg("score");

    const lastS = sessions[sessions.length - 1];

    const summary = {
      avgROM:           parseFloat(avgROM.toFixed(1)),
      avgStrength:      parseFloat(avgStrength.toFixed(2)),
      avgEndurance:     Math.round(avgEndurance),
      avgMovementCount: Math.round(avgMoves),
      avgScore:         Math.round(avgScore),
      lastROM:          parseFloat(Number(lastS.rangeOfMotion || 0).toFixed(1)),
      lastScore:        Number(lastS.score || 0),
      sessionCount:     sessions.length,
      lastSessionDate:  lastS.createdAt
    };

    // ─── Алерты ────────────────────────────────────────────────────────────
    const alerts = [];

    const addAlert = (id, metricKey, value, extra = {}) => {
      const t = THRESHOLDS[metricKey];
      const severity = checkMetric(value, t);
      if (severity === "good") return;

      const messages = {
        rom: {
          critical: `Критически низкая амплитуда: ${value.toFixed(1)}°. Норма > ${t.warning}°`,
          warning:  `Слабая амплитуда движений: ${value.toFixed(1)}°. Стремиться к > ${t.warning}°`
        },
        strength: {
          critical: `Очень слабые движения (индекс ${value.toFixed(2)}). Пациент не дотягивается до нужного угла`,
          warning:  `Слабые движения — индекс силы ${value.toFixed(2)} из 1.0`
        },
        endurance: {
          critical: `Очень низкая выносливость: ${value}с активного движения`,
          warning:  `Пациент активен только ${value}с за сессию — рекомендуется увеличить`
        },
        movementCount: {
          critical: `Критически мало движений: ${value} за сессию`,
          warning:  `Мало движений: ${value}. Рекомендуется > ${t.warning}`
        },
        zoneHits: {
          critical: `Нет направленных движений (zone hits: ${value})`,
          warning:  `Слабые направленные движения: ${value} за сессию`
        }
      };

      alerts.push({
        id,
        severity,
        metric: t.label,
        text: messages[metricKey][severity],
        value: parseFloat(value.toFixed(2)),
        threshold: t.warning,
        unit: t.unit,
        ...extra
      });
    };

    addAlert("avg_rom",       "rom",           avgROM);
    addAlert("avg_strength",  "strength",      avgStrength);
    addAlert("avg_endurance", "endurance",     avgEndurance);
    addAlert("avg_moves",     "movementCount", avgMoves);

    // zoneHits — только если есть новые сессии с этим полем
    const recentZoneHits = sessions.slice(-3).map(s => Number(s.zoneHits || 0));
    const avgZoneHits = recentZoneHits.reduce((a, b) => a + b, 0) / recentZoneHits.length;
    addAlert("zone_hits", "zoneHits", avgZoneHits);

    // Регресс ROM (критично если тренд вниз + значение низкое)
    const romVals = sessions.map(s => Number(s.rangeOfMotion || 0));
    const romSlope = linearSlope(romVals);
    if (romSlope < -0.8 && avgROM < 30) {
      alerts.push({
        id: "rom_regression",
        severity: "warning",
        metric: "Тренд ROM",
        text: `Амплитуда снижается от сессии к сессии (наклон: ${romSlope.toFixed(1)}°/сес.)`,
        value: romSlope,
        unit: "°/сес."
      });
    }

    // Падение score
    const scoreVals = sessions.map(s => Number(s.score || 0));
    const scoreSlope = linearSlope(scoreVals);
    if (scoreSlope < -2 && sessions.length >= 3) {
      alerts.push({
        id: "score_decline",
        severity: "warning",
        metric: "Тренд очков",
        text: `Результаты снижаются (${scoreSlope.toFixed(1)} очк./сес.). Возможна усталость или боль`,
        value: scoreSlope,
        unit: "очк./сес."
      });
    }

    // ─── Тренды ────────────────────────────────────────────────────────────
    const buildTrend = (key) => {
      const vals = sessions.map(s => parseFloat(Number(s[key] || 0).toFixed(2)));
      const slope = linearSlope(vals);
      return {
        direction: trendDirection(slope),
        slope: parseFloat(slope.toFixed(3)),
        values: vals,
        labels: sessions.map((_, i) => `#${i + 1}`),
        avg: parseFloat((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)),
        last: vals[vals.length - 1]
      };
    };

    const trends = {
      rom:           buildTrend("rangeOfMotion"),
      strength:      buildTrend("strengthIndex"),
      endurance:     buildTrend("enduranceSec"),
      movementCount: buildTrend("movementCount"),
      score:         buildTrend("score")
    };

    // ─── Итоговый статус ───────────────────────────────────────────────────
    const hasCritical = alerts.some(a => a.severity === "critical");
    const hasWarning  = alerts.some(a => a.severity === "warning");
    const overallStatus = hasCritical ? "critical" : hasWarning ? "needs_attention" : "good";

    res.json({ summary, alerts, trends, overallStatus });

  } catch (error) {
    console.error("INSIGHTS ERROR:", error);
    res.status(500).json({ message: "Сервер қатесі" });
  }
});

module.exports = router;
