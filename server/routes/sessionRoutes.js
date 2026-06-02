const express = require("express");
const auth = require("../middleware/authMiddleware");
const dbAccess = require("../middleware/databaseAccessMiddleware");
const Session = require("../models/Session");
const Patient = require("../models/Patient");

const router = express.Router();

router.post("/", auth, dbAccess, async (req, res) => {
  try {
    if (req.currentUserDoc.role !== "doctor" && req.currentUserDoc.role !== "admin") {
      return res.status(403).json({ message: "Тек doctor немесе admin session сақтай алады" });
    }

    const {
      patientId, yaw, pitch, roll, score, durationSec, level,
      minAngle, maxAngle, rangeOfMotion, strengthIndex, enduranceSec, movementCount,
      gameType, gameName,
      imuTimeSeries,   // [{t, r, p, y}, ...] — time-series из игры
      maxCombo, zoneHits
    } = req.body;

    if (!patientId) {
      return res.status(400).json({ message: "patientId керек" });
    }

    const patient = await Patient.findById(patientId);

    if (!patient) {
      return res.status(404).json({ message: "Пациент табылмады" });
    }

    if (
      req.currentUserDoc.role !== "admin" &&
      String(patient.doctorId) !== String(req.currentUserDoc._id)
    ) {
      return res.status(403).json({ message: "Бұл пациент сізге тиесілі емес" });
    }

    // Если передан imuTimeSeries — вычисляем реальный ROM из него
    let computedMin = Number(minAngle) || 0;
    let computedMax = Number(maxAngle) || 0;
    let computedROM = Number(rangeOfMotion) || 0;
    let computedMoveCount = Number(movementCount) || 0;
    let computedStrength = Number(strengthIndex) || 0;
    let computedEndurance = Number(enduranceSec) || 0;

    if (Array.isArray(imuTimeSeries) && imuTimeSeries.length > 0) {
      const rolls = imuTimeSeries.map(p => p.r).filter(v => typeof v === "number");
      if (rolls.length > 0) {
        computedMin = Math.min(...rolls);
        computedMax = Math.max(...rolls);
        computedROM = computedMax - computedMin;

        // strengthIndex = насколько далеко пациент дотянулся (0-1, где 1 = ±45°)
        const maxAbsRoll = Math.max(...rolls.map(Math.abs));
        computedStrength = Math.min(1, parseFloat((maxAbsRoll / 45).toFixed(3)));

        // movementCount = кол-во значимых смен направления
        let changes = 0;
        for (let i = 1; i < rolls.length; i++) {
          if (Math.abs(rolls[i] - rolls[i - 1]) > 1.5) changes++;
        }
        computedMoveCount = changes;

        // enduranceSec = время активного движения (|roll| > 5°)
        const sampleIntervalSec = 0.2;
        const activeSamples = rolls.filter(r => Math.abs(r) > 5).length;
        computedEndurance = Math.round(activeSamples * sampleIntervalSec);
      }
    }

    const session = await Session.create({
      patientId,
      doctorId: req.currentUserDoc._id,
      yaw: Number(yaw) || 0,
      pitch: Number(pitch) || 0,
      roll: Number(roll) || 0,
      score: Number(score) || 0,
      durationSec: Number(durationSec) || 0,
      level: Number(level) || 1,
      minAngle: computedMin,
      maxAngle: computedMax,
      rangeOfMotion: computedROM,
      strengthIndex: computedStrength,
      enduranceSec: computedEndurance,
      movementCount: computedMoveCount,
      maxCombo: Number(maxCombo) || 0,
      zoneHits: Number(zoneHits) || 0,
      gameType: gameType || "game1",
      gameName: gameName || "",
      imuTimeSeries: Array.isArray(imuTimeSeries) ? imuTimeSeries : []
    });

    res.status(201).json({
      message: "Session сақталды",
      session
    });
  } catch (error) {
    console.error("SAVE SESSION ERROR:", error);
    res.status(500).json({ message: "Сервер қатесі" });
  }
});

router.get("/:patientId", auth, dbAccess, async (req, res) => {
  try {
    const patient = await Patient.findById(req.params.patientId);

    if (!patient) {
      return res.status(404).json({ message: "Пациент табылмады" });
    }

    if (
      req.currentUserDoc.role !== "admin" &&
      String(patient.doctorId) !== String(req.currentUserDoc._id)
    ) {
      return res.status(403).json({ message: "Бұл пациент сізге тиесілі емес" });
    }

    const sessions = await Session.find({ patientId: req.params.patientId }).sort({ createdAt: -1 });

    res.json(sessions);
  } catch (error) {
    console.error("GET SESSION ERROR:", error);
    res.status(500).json({ message: "Сервер қатесі" });
  }
});

module.exports = router;