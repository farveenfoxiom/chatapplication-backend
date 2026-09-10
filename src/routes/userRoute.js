const express = require("express");

const protect = require("../middleware/authMiddleware");
const upload = require("../config/upload");
const {getMe,updateMe,searchUsers,getUserById ,uploadProfileImage} = require("../controllers/userController");

const router = express.Router();

router.get("/me", protect, getMe);
router.get("/search", protect, searchUsers);
router.get("/:userId", protect, getUserById);
router.put("/me", protect, updateMe);
router.post("/me/image",protect,upload.single("image"),uploadProfileImage);


module.exports = router;