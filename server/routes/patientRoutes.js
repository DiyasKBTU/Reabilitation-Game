const express = require("express");
const auth = require("../middleware/authMiddleware");
const dbAccess = require("../middleware/databaseAccessMiddleware");
const Patient = require("../models/Patient");

const router = express.Router();

router.post("/", auth, dbAccess, async (req, res) => {
  try {
    if (req.currentUserDoc.role !== "doctor" && req.currentUserDoc.role !== "admin") {
      return res.status(403).json({ message: "Тек doctor немесе admin пациент қоса алады" });
    }

    const { fullName, age, diagnosis, notes } = req.body;

    if (!fullName) {
      return res.status(400).json({ message: "Пациент аты керек" });
    }

    const patient = await Patient.create({
      fullName,
      age: Number(age) || 0,
      diagnosis: diagnosis || "",
      notes: notes || "",
      doctorId: req.currentUserDoc._id,
      createdBy: req.currentUserDoc._id
    });

    res.status(201).json(patient);
  } catch (error) {
    console.error("CREATE PATIENT ERROR:", error);
    res.status(500).json({ message: "Сервер қатесі" });
  }
});

router.get("/", auth, dbAccess, async (req, res) => {
  try {
    let patients = [];

    if (req.currentUserDoc.role === "admin") {
      patients = await Patient.find().sort({ createdAt: -1 });
    } else if (req.currentUserDoc.role === "doctor") {
      patients = await Patient.find({ doctorId: req.currentUserDoc._id }).sort({ createdAt: -1 });
    } else {
      return res.status(403).json({ message: "Пациенттер тізімі қолжетімсіз" });
    }

    res.json(patients);
  } catch (error) {
    console.error("GET PATIENTS ERROR:", error);
    res.status(500).json({ message: "Сервер қатесі" });
  }
});

module.exports = router;