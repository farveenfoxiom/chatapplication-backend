const express = require("express");

const router = express.Router();

const {
  createGroup,
  getUserGroups,
  getGroupById,
  updateGroupInfo,
  updateGroupMembers,
  updateGroupAdmins,
  leaveGroup,
  getGroupMessages,
  markGroupMessagesAsRead,
  clearGroupChat,
} = require("../controllers/groupController");
const protect = require("../middleware/authMiddleware");
const {upload} = require("../middleware/uploadMiddleware");

router.post("/",protect,createGroup);
router.get("/",protect,getUserGroups);
router.get("/:groupId",protect, getGroupById);
router.put("/:groupId",protect,upload.single("groupImage"),updateGroupInfo);
router.put("/:groupId/members", protect, updateGroupMembers);
router.put( "/:groupId/admins",protect,updateGroupAdmins);
router.post("/:groupId/leave",protect,leaveGroup);
router.get("/:groupId/messages",protect,getGroupMessages);
router.patch("/:groupId/read",protect,markGroupMessagesAsRead);
router.patch("/:groupId/clear",protect,clearGroupChat);

module.exports = router;