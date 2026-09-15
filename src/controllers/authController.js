const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/User");

const STATUS_CODES = require("../constants/statusCodes");
const MESSAGES = require("../constants/messages");

const {sendSuccess, sendError} = require("../utils/response");


const signup = async (req, res) => {
  try {
    const { name, username, email, password } = req.body;
    if (!name || !username || !email || !password) {
      return sendError(
        res,
        STATUS_CODES.BAD_REQUEST,
        "All fields are required"
      );
    }
    const normalizedUsername = username.trim().toLowerCase();
    const normalizedEmail = email.trim().toLowerCase();
    const existingUsername = await User.findOne({
      username: normalizedUsername,
    });

    if (existingUsername) {
      return sendError(
        res,
        STATUS_CODES.CONFLICT,
        "Username already exists"
      );
    }
    const existingEmail = await User.findOne({
      email: normalizedEmail,
    });
    if (existingEmail) {
      return sendError(
        res,
        STATUS_CODES.CONFLICT,
        "Email already exists"
      );
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      username: normalizedUsername,
      email: normalizedEmail,
      password: hashedPassword,
    });
    return sendSuccess(
      res,
      STATUS_CODES.CREATED,
      {
        message: "User created successfully",
        user: {
          id: user._id,
          name: user.name,
          username: user.username,
          email: user.email,
          profileImage: user.profileImage,
          bio: user.bio,
        },
      }
    );
  } catch (error) {
    console.error("Signup error:", error);
    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

const login = async (req, res) => {
  try {
    const { identifier, password } = req.body;
    if (!identifier || !password) {
      return sendError(
        res,
        STATUS_CODES.BAD_REQUEST,
        "Username/email and password are required"
      );
    }
    const normalizedIdentifier =
      identifier.trim().toLowerCase();
    const user = await User.findOne({
      $or: [
        { email: normalizedIdentifier },
        { username: normalizedIdentifier },
      ],
    });

    if (!user) {
      return sendError(
        res,
        STATUS_CODES.UNAUTHORIZED,
        "Invalid username/email or password"
      );
    }
    const isPasswordCorrect =
      await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
      return sendError(
        res,
        STATUS_CODES.UNAUTHORIZED,
        "Invalid username/email or password"
      );
    }
    const token = jwt.sign(
      {
        userId: user._id,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );
    return sendSuccess(
      res,
      STATUS_CODES.OK,
      {
        message: "Login successful",
        token,
        user: {
          id: user._id,
          name: user.name,
          username: user.username,
          email: user.email,
          profileImage: user.profileImage,
          bio: user.bio,
        },
      }
    );
  } catch (error) {
    console.error("Login error:", error);
    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

module.exports = {signup,login};