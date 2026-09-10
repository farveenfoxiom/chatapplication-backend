const express = require("express");

const authRoutes = require("./authRoute");
const userRoutes = require("./userRoute");
const messageRoutes = require("./messageRoutes");
const chatRoutes = require("./chatRoutes");

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/users", userRoutes);
router.use("/messages", messageRoutes);
router.use("/chats", chatRoutes);

module.exports = router;