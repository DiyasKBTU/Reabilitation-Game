const express = require("express");
const auth = require("../middleware/authMiddleware");
const admin = require("../middleware/adminMiddleware");

const User = require("../models/User");
const Patient = require("../models/Patient");
const Session = require("../models/Session");

const router = express.Router();

// Барлық user-лер
router.get("/users", auth, admin, async (req, res) => {
  try {
    const users = await User.find().select("-password").sort({ createdAt: -1 });
    res.json(users);
  } catch (error) {
    console.error("ADMIN USERS ERROR:", error);
    res.status(500).json({ message: "Сервер қатесі" });
  }
});

// Platform access беру/алу
router.patch("/platform-access/:id", auth, admin, async (req, res) => {
  try {
    const { value } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: "User табылмады" });
    }

    if (user.role === "admin") {
      return res.status(400).json({ message: "Admin өзгертілмейді" });
    }

    user.platformAccess = Boolean(value);

    // Егер platform access алынса, база доступын да өшірген дұрыс
    if (!user.platformAccess) {
      user.databaseAccess = false;
    }

    await user.save();

    res.json({
      message: user.platformAccess
        ? "Платформаға доступ берілді"
        : "Платформаға доступ алынды",
      user
    });
  } catch (error) {
    console.error("PLATFORM ACCESS ERROR:", error);
    res.status(500).json({ message: "Сервер қатесі" });
  }
});

// Database access беру/алу
router.patch("/database-access/:id", auth, admin, async (req, res) => {
  try {
    const { value } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: "User табылмады" });
    }

    if (user.role === "admin") {
      return res.status(400).json({ message: "Admin өзгертілмейді" });
    }

    // Базаға доступ беру үшін platformAccess true болуы керек
    if (Boolean(value) === true && !user.platformAccess) {
      return res.status(400).json({
        message: "Алдымен платформаға доступ беру керек"
      });
    }

    // patient-ке база доступ бермейміз
    if (Boolean(value) === true && user.role === "patient") {
      return res.status(400).json({
        message: "Patient-ке база доступ берілмейді"
      });
    }

    user.databaseAccess = Boolean(value);
    await user.save();

    res.json({
      message: user.databaseAccess
        ? "Базаға доступ берілді"
        : "Базаға доступ алынды",
      user
    });
  } catch (error) {
    console.error("DATABASE ACCESS ERROR:", error);
    res.status(500).json({ message: "Сервер қатесі" });
  }
});

// Block / Unblock
router.patch("/block/:id", auth, admin, async (req, res) => {
  try {
    const { value } = req.body;
    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: "User табылмады" });
    }

    if (user.role === "admin") {
      return res.status(400).json({ message: "Admin блокталмайды" });
    }

    user.blocked = Boolean(value);

    // Егер блокталса, platform/database access-ты да өшіреміз
    if (user.blocked) {
      user.platformAccess = false;
      user.databaseAccess = false;
    }

    await user.save();

    res.json({
      message: user.blocked ? "User блокталды" : "User unblock болды",
      user
    });
  } catch (error) {
    console.error("BLOCK ERROR:", error);
    res.status(500).json({ message: "Сервер қатесі" });
  }
});

// Role ауыстыру
router.patch("/role/:id", auth, admin, async (req, res) => {
  try {
    const { role } = req.body;
    const allowedRoles = ["doctor", "patient"];

    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ message: "Role қате" });
    }

    const user = await User.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: "User табылмады" });
    }

    if (user.role === "admin") {
      return res.status(400).json({ message: "Admin role өзгертілмейді" });
    }

    user.role = role;

    // Егер patient қылсақ, база доступын өшіреміз
    if (role === "patient") {
      user.databaseAccess = false;
    }

    await user.save();

    res.json({
      message: `Role ${role} болып жаңартылды`,
      user
    });
  } catch (error) {
    console.error("ROLE UPDATE ERROR:", error);
    res.status(500).json({ message: "Сервер қатесі" });
  }
});

// Барлық пациенттер
router.get("/patients", auth, admin, async (req, res) => {
  try {
    const patients = await Patient.find().sort({ createdAt: -1 });
    res.json(patients);
  } catch (error) {
    console.error("ADMIN PATIENTS ERROR:", error);
    res.status(500).json({ message: "Сервер қатесі" });
  }
});

// Барлық session-дар
router.get("/sessions", auth, admin, async (req, res) => {
  try {
    const sessions = await Session.find().sort({ createdAt: -1 }).limit(300);
    res.json(sessions);
  } catch (error) {
    console.error("ADMIN SESSIONS ERROR:", error);
    res.status(500).json({ message: "Сервер қатесі" });
  }
});

module.exports = router;