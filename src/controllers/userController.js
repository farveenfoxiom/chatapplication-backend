const User = require("../models/User");

const STATUS_CODES = require("../constants/statusCodes");
const MESSAGES = require("../constants/messages");

const {
  sendSuccess,
  sendError,
} = require("../utils/response");

const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select("-password");

    if (!user) {
      return sendError(
        res,
        STATUS_CODES.NOT_FOUND,
        MESSAGES.USER_NOT_FOUND
      );
    }

    return sendSuccess(
      res,
      STATUS_CODES.OK,
      {
        user,
      }
    );
  } catch (error) {
    console.error("Get me error:", error);

    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

const updateMe = async (req, res) => {
  try {
    const {
      name,
      username,
      email,
      bio,
      profileImage,
    } = req.body;

    const user = await User.findById(req.user.userId);

    if (!user) {
      return sendError(
        res,
        STATUS_CODES.NOT_FOUND,
        MESSAGES.USER_NOT_FOUND
      );
    }

    if (name !== undefined) {
      user.name = name;
    }

    if (username !== undefined) {
      user.username = username;
    }

    if (email !== undefined) {
      user.email = email;
    }

    if (bio !== undefined) {
      user.bio = bio;
    }

    if (profileImage !== undefined) {
      user.profileImage = profileImage;
    }

    await user.save();

    return sendSuccess(
      res,
      STATUS_CODES.OK,
      {
        message: MESSAGES.PROFILE_UPDATED,
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
    console.error("Update profile error:", error);

    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

const searchUsers = async (req, res) => {
  try {
    const { query, skip = 0, limit = 7 } = req.query;

    if (!query || query.trim() === "") {
      return sendError(
        res,
        STATUS_CODES.BAD_REQUEST,
        MESSAGES.SEARCH_QUERY_REQUIRED
      );
    }

    const searchTerm = query.trim();

    const skipNumber = Number(skip);
    const limitNumber = Number(limit);

    const filter = {
      _id: {
        $ne: req.user.userId,
      },
      $or: [
        {
          name: {
            $regex: searchTerm,
            $options: "i",
          },
        },
        {
          username: {
            $regex: searchTerm,
            $options: "i",
          },
        },
        {
          email: {
            $regex: searchTerm,
            $options: "i",
          },
        },
      ],
    };

    const users = await User.find(filter)
      .select("-password")
      .skip(skipNumber)
      .limit(limitNumber);

    return sendSuccess(res, STATUS_CODES.OK, {
      users,
      hasMore: users.length === limitNumber,
    });
  } catch (error) {
    console.error("Search users error:", error);

    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

const getUserById = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).select("-password");

    if (!user) {
      return sendError(
        res,
        STATUS_CODES.NOT_FOUND,
        MESSAGES.USER_NOT_FOUND
      );
    }

    return sendSuccess(
      res,
      STATUS_CODES.OK,
      {
        user,
      }
    );
  } catch (error) {
    console.error("Get user error:", error);

    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

const uploadProfileImage = async (req, res) => {
  try {
    if (!req.file) {
      return sendError(
        res,
        STATUS_CODES.BAD_REQUEST,
        MESSAGES.IMAGE_REQUIRED
      );
    }

    const user = await User.findById(req.user.userId);

    if (!user) {
      return sendError(
        res,
        STATUS_CODES.NOT_FOUND,
        MESSAGES.USER_NOT_FOUND
      );
    }

    // Store the local image URL in MongoDB
    const imageUrl = `/uploads/profile-images/${req.file.filename}`;

    user.profileImage = imageUrl;

    await user.save();

    return sendSuccess(
      res,
      STATUS_CODES.OK,
      {
        message: MESSAGES.PROFILE_IMAGE_UPLOADED,
        profileImage: imageUrl,
      }
    );
  } catch (error) {
    console.error("Upload profile image error:", error);

    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};
module.exports = {
  getMe,
  updateMe,
  searchUsers,
  getUserById,
  uploadProfileImage,
};