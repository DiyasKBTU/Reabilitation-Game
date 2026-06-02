const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const auth = require("../middleware/authMiddleware");

const router = express.Router();

function createToken(user) {
  return jwt.sign(
    {
      id: user._id,
      username: user.username,
      role: user.role
    },
    process.env.JWT_SECRET || "secret123",
    { expiresIn: "7d" }
  );
}

// REGISTER
router.post("/register", async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ message: "Барлық өрісті толтыр" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Құпия сөз кемінде 6 таңба болу керек" });
    }

    const existingUser = await User.findOne({
      $or: [{ username }, { email }]
    });

    if (existingUser) {
      return res.status(400).json({ message: "Мұндай логин немесе email бар" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      username: username.trim(),
      email: email.trim(),
      password: hashedPassword,
      role: "patient"
    });

    return res.status(201).json({
      message: "Тіркелу сәтті аяқталды",
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error("REGISTER ERROR:", error);
    return res.status(500).json({ message: "Сервер қатесі" });
  }
});

// LOGIN
router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ message: "Логин мен пароль керек" });
    }

    const user = await User.findOne({
      $or: [{ username }, { email: username }]
    });

    if (!user) {
      return res.status(400).json({ message: "Қате логин немесе пароль" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Қате логин немесе пароль" });
    }

    if (user.blocked) {
      return res.status(403).json({ message: "Аккаунт блокталған" });
    }

    const token = createToken(user);

    return res.json({
      message: "Сәтті кірдің",
      token,
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        fullName: user.fullName || "",
        phone: user.phone || "",
        specialty: user.specialty || "",
        workplace: user.workplace || "",
        bio: user.bio || "",
        avatar: user.avatar || "",
        platformAccess: user.platformAccess,
        databaseAccess: user.databaseAccess,
        blocked: user.blocked
      }
    });
  } catch (error) {
    console.error("LOGIN ERROR:", error);
    return res.status(500).json({ message: "Сервер қатесі" });
  }
});

// GET CURRENT USER
router.get("/me", auth, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;
    const user = await User.findById(userId).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User табылмады" });
    }

    return res.json(user);
  } catch (error) {
    console.error("GET ME ERROR:", error);
    return res.status(500).json({ message: "Сервер қатесі" });
  }
});

// UPDATE PROFILE
router.put("/update-profile", auth, async (req, res) => {
  try {
    const userId = req.user.id || req.user._id;

    const {
      fullName,
      email,
      phone,
      specialty,
      workplace,
      bio,
      avatar,
      password
    } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User табылмады" });
    }

    if (typeof fullName !== "undefined") user.fullName = String(fullName).trim();
    if (typeof email !== "undefined") user.email = String(email).trim();
    if (typeof phone !== "undefined") user.phone = String(phone).trim();
    if (typeof specialty !== "undefined") user.specialty = String(specialty).trim();
    if (typeof workplace !== "undefined") user.workplace = String(workplace).trim();
    if (typeof bio !== "undefined") user.bio = String(bio).trim();
    if (typeof avatar !== "undefined") user.avatar = avatar;

    if (password && String(password).trim()) {
      const newPassword = String(password).trim();

      if (newPassword.length < 6) {
        return res.status(400).json({ message: "Жаңа пароль кемінде 6 таңба болу керек" });
      }

      user.password = await bcrypt.hash(newPassword, 10);
    }

    await user.save();

    return res.json({
      message: "Профиль сақталды",
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        role: user.role,
        fullName: user.fullName || "",
        phone: user.phone || "",
        specialty: user.specialty || "",
        workplace: user.workplace || "",
        bio: user.bio || "",
        avatar: user.avatar || "",
        platformAccess: user.platformAccess,
        databaseAccess: user.databaseAccess,
        blocked: user.blocked
      }
    });
  } catch (error) {
    console.error("UPDATE PROFILE ERROR:", error);
    return res.status(500).json({ message: "Сервер қатесі" });
  }
});

module.exports = router;