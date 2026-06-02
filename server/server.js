const express = require("express");
const cors = require("cors");
require("dotenv").config();

const connectDB = require("./config/db");
const authRoutes = require("./routes/authRoutes");
const adminRoutes = require("./routes/adminRoutes");
const patientRoutes = require("./routes/patientRoutes");
const sessionRoutes = require("./routes/sessionRoutes");
const profileRoutes = require("./routes/profileRoutes");
const scoreRoutes = require("./routes/scoreRoutes");
const insightsRoutes = require("./routes/insightsRoutes");

const User = require("./models/User");
const bcrypt = require("bcryptjs");

const app = express();

const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://localhost:5000,http://127.0.0.1:5500")
  .split(",")
  .map(o => o.trim());

app.use(cors({
  origin: function (origin, callback) {
    // allow requests with no origin (file://, Postman, mobile apps)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS: origin not allowed — " + origin));
  },
  credentials: true
}));
app.use(express.json({ limit: "2mb" })); // увеличен лимит для imuTimeSeries

app.get("/", (req, res) => {
  res.send("🚀 Server is running");
});

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/patient", patientRoutes);
app.use("/api/session", sessionRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/score", scoreRoutes);
app.use("/api/insights", insightsRoutes);

async function createDefaultAdmin() {
  try {
    const existingAdmin = await User.findOne({ username: "admin" });

    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash("123456", 10);

      await User.create({
        username: "admin",
        email: "admin@mail.com",
        password: hashedPassword,
        role: "admin",
        platformAccess: true,
        databaseAccess: true,
        blocked: false
      });

      console.log("✅ Default admin created: admin / 123456");
    }
  } catch (error) {
    console.error("ADMIN CREATE ERROR:", error);
  }
}

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    await connectDB();

    app.listen(PORT, async () => {
      console.log(`🔥 Server started on port ${PORT}`);
      await createDefaultAdmin();
    });
  } catch (error) {
    console.error("❌ Server start error:", error.message);
  }
}

startServer();