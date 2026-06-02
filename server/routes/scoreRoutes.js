const express = require("express");
const auth = require("../middleware/authMiddleware");
const Score = require("../models/Score");

const router = express.Router();

router.post("/", auth, async (req, res) => {
  try {
    const { score } = req.body;

    if (score === undefined || score === null) {
      return res.status(400).json({ message: "Score жоқ" });
    }

    const newScore = await Score.create({
      userId: req.user.id,
      username: req.user.username,
      score: Number(score) || 0
    });

    res.json({
      message: "Score сақталды",
      score: newScore
    });
  } catch (error) {
    console.error("SAVE SCORE ERROR:", error);
    res.status(500).json({ message: "Сервер қатесі" });
  }
});

router.get("/leaderboard", async (req, res) => {
  try {
    const scores = await Score.find()
      .sort({ score: -1, createdAt: 1 })
      .limit(20);

    res.json(scores);
  } catch (error) {
    console.error("LEADERBOARD ERROR:", error);
    res.status(500).json({ message: "Сервер қатесі" });
  }
});

module.exports = router;