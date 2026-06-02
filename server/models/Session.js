const mongoose = require("mongoose");

const sessionSchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true
    },

    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    yaw: {
      type: Number,
      default: 0
    },

    pitch: {
      type: Number,
      default: 0
    },

    roll: {
      type: Number,
      default: 0
    },

    score: {
      type: Number,
      default: 0
    },

    durationSec: {
      type: Number,
      default: 0
    },

    level: {
      type: Number,
      default: 1
    },

    // Analytics fields from IMU device
    minAngle: {
      type: Number,
      default: 0
    },

    maxAngle: {
      type: Number,
      default: 0
    },

    rangeOfMotion: {
      type: Number,
      default: 0
    },

    strengthIndex: {
      type: Number,
      default: 0
    },

    enduranceSec: {
      type: Number,
      default: 0
    },

    movementCount: {
      type: Number,
      default: 0
    },

    // Комбо и геймплей метрики
    maxCombo: {
      type: Number,
      default: 0
    },

    zoneHits: {
      type: Number,
      default: 0  // кол-во пойманных зональных шаров
    },

    // Game identification
    gameType: {
      type: String,
      default: "game1"
    },

    gameName: {
      type: String,
      default: ""
    },

    // IMU time-series: [{t: ms, r: roll, p: pitch, y: yaw}, ...]
    // Записывается каждые ~200ms во время игры
    // Используется для AI-анализа: ROM, плавность, симметрия
    imuTimeSeries: {
      type: [
        {
          t: { type: Number },  // ms от старта игры
          r: { type: Number },  // roll
          p: { type: Number },  // pitch
          y: { type: Number }   // yaw
        }
      ],
      default: []
    },

    // Оставлен для обратной совместимости, deprecated
    rawSnapshot: {
      type: String,
      default: ""
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model("Session", sessionSchema);