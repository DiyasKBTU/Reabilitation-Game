module.exports = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "Қол жеткізу жоқ" });
  }

  if (req.user.role !== "admin") {
    return res.status(403).json({ message: "Тек admin кіре алады" });
  }

  next();
};