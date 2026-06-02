const express = require("express");
const auth = require("../middleware/authMiddleware");
const User = require("../models/User");
const Patient = require("../models/Patient");
const Session = require("../models/Session");

const router = express.Router();

router.get("/", auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User табылмады" });
    }

    const stats = {
      patientCount: 0,
      sessionCount: 0,
      bestScore: 0
    };

    if (user.role === "doctor" || user.role === "admin") {
      const patients =
        user.role === "admin"
          ? await Patient.find()
          : await Patient.find({ doctorId: user._id });

      const patientIds = patients.map((p) => p._id);

      stats.patientCount = patients.length;
      stats.sessionCount = await Session.countDocuments({ patientId: { $in: patientIds } });

      const bestSession = await Session.findOne({ patientId: { $in: patientIds } }).sort({ score: -1 });
      stats.bestScore = bestSession ? bestSession.score : 0;
    }

    res.json({
      user,
      stats
    });
  } catch (error) {
    console.error("PROFILE ERROR:", error);
    res.status(500).json({ message: "Сервер қатесі" });
  }
});

module.exports = router;