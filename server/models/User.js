const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true
    },
    password: {
      type: String,
      required: true
    },

    role: {
      type: String,
      enum: ["admin", "doctor", "patient", "user"],
      default: "patient"
    },

    fullName: {
      type: String,
      default: "",
      trim: true
    },
    phone: {
      type: String,
      default: "",
      trim: true
    },
    specialty: {
      type: String,
      default: "",
      trim: true
    },
    workplace: {
      type: String,
      default: "",
      trim: true
    },
    bio: {
      type: String,
      default: "",
      trim: true
    },
    avatar: {
      type: String,
      default: ""
    },

    platformAccess: {
      type: Boolean,
      default: false
    },
    databaseAccess: {
      type: Boolean,
      default: false
    },
    blocked: {
      type: Boolean,
      default: false
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);