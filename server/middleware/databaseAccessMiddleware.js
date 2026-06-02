const User = require("../models/User");

module.exports = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);

    if (!user) {
      return res.status(404).json({ message: "User табылмады" });
    }

    if (user.blocked) {
      return res.status(403).json({ message: "Аккаунт блокталған" });
    }

    if (!user.platformAccess) {
      return res.status(403).json({ message: "Системаға доступ жоқ" });
    }

    if (!user.databaseAccess) {
      return res.status(403).json({ message: "Базаға доступ жоқ" });
    }

    req.currentUserDoc = user;
    next();
  } catch (error) {
    console.error("DATABASE ACCESS ERROR:", error);
    res.status(500).json({ message: "Сервер қатесі" });
  }
};