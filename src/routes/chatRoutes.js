const express = require("express");

const protect = require("../middleware/authMiddleware");
const {getRecentChats,getChatPreview,deleteChat} = require("../controllers/chatController");

const router = express.Router();

router.get("/", protect, getRecentChats);
router.delete("/:userId",protect,deleteChat);
router.get("/preview/:userId", protect , getChatPreview);

module.exports = router;