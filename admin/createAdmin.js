const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const User = require("./models/User");

const MONGO_URI = "mongodb://admin:87056714495@ac-qt9i7ya-shard-00-00.audcc2p.mongodb.net:27017,ac-qt9i7ya-shard-00-01.audcc2p.mongodb.net:27017,ac-qt9i7ya-shard-00-02.audcc2p.mongodb.net:27017/space_game_db?ssl=true&replicaSet=atlas-eppkux-shard-0&authSource=admin&retryWrites=true&w=majority&appName=Cluster0";

async function createAdmin() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log("MongoDB connected");

    const exists = await User.findOne({ email: "admin@gmail.com" });

    if (exists) {
      exists.role = "admin";
      exists.username = "admin";
      exists.password = await bcrypt.hash("123456", 10);
      exists.platformAccess = true;
      exists.databaseAccess = true;
      exists.blocked = false;

      await exists.save();
      console.log("Admin updated");
    } else {
      const hashedPassword = await bcrypt.hash("123456", 10);

      await User.create({
        username: "admin",
        email: "admin@gmail.com",
        password: hashedPassword,
        role: "admin",
        platformAccess: true,
        databaseAccess: true,
        blocked: false
      });

      console.log("Admin created");
    }

    console.log("Login: admin@gmail.com");
    console.log("Password: 123456");

    process.exit();
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

createAdmin();