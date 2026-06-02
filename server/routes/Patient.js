const mongoose = require("mongoose");

const patientSchema = new mongoose.Schema(
  {
    fullName: {
      type: String,
      required: true
    },
    age: {
      type: Number,
      default: 0
    },
    diagnosis: {
      type: String,
      default: ""
    },
    notes: {
      type: String,
      default: ""
    },
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Patient", patientSchema);