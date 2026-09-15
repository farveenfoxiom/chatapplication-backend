const express = require("express");

const protect = require("../middleware/authMiddleware");
const upload = require("../middleware/uploadMiddleware");
const {sendMessage , getMessages , deleteMessage ,markMessagesAsRead,editMessage } = require("../controllers/messageController");

const router = express.Router();

router.post("/", protect, upload.single("file"), sendMessage);
router.get("/:userId", protect, getMessages);
router.delete("/:messageId" , protect , deleteMessage);
router.put("/:userId/read",protect , markMessagesAsRead);
router.put("/:messageId", protect, editMessage);


module.exports = router;