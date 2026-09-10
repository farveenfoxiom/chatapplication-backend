const express = require("express");

const { signup , login} = require("../controllers/authController");
const {getMe , searchUsers} = require("../controllers/userController")
const protect = require("../middleware/authMiddleware");

const router = express.Router();

router.post("/signup", signup);
router.post("/login", login);
router.get("/me", protect, getMe);
router.get("/search", protect, searchUsers);

module.exports = router;