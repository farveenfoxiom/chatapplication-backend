const Message = require("../models/Message");
const User = require("../models/User");

const STATUS_CODES = require("../constants/statusCodes");
const MESSAGES = require("../constants/messages");

const { sendSuccess, sendError } = require("../utils/response");

const getMessagePreview = (message) => {
  if (message.isDeletedForEveryone) {
    return "This message was deleted";
  }

  if (message.messageType === "image") {
    return "📷 Photo";
  }

  if (message.messageType === "video") {
    return "🎥 Video";
  }

  if (message.messageType === "location") {
    return message.location?.isLive
     ? "📍 Live location"
     : "📍 location"
  }

  if (message.messageType === "file") {
    return `📎 ${message.fileName || "File"}`;
  }

  if (message.fileUrl && message.fileName) {
    const extension = message.fileName.split(".").pop()?.toLowerCase();

    const imageExtensions = ["jpg", "jpeg", "png", "webp", "gif"];
    const videoExtensions = ["mp4", "webm", "mov", "avi", "mkv"];

    if (imageExtensions.includes(extension)) {
      return "📷 Photo";
    }

    if (videoExtensions.includes(extension)) {
      return "🎥 Video";
    }

    return `📎 ${message.fileName}`;
  }

  return message.text || "";
};

const getChatSummary = async (currentUser, otherUserId) => {
  const messages = await Message.find({
    $or: [
      { sender: currentUser, receiver: otherUserId },
      { sender: otherUserId, receiver: currentUser },
    ],
  }).sort({ createdAt: -1 });

  let lastMessage = "";
  let lastMessageTime = null;
  let lastMessageFound = false;
  let unreadCount = 0;

  for (const message of messages) {
    const chatDeletion = message.chatDeletedFor?.find(
      (item) => item.user.toString() === currentUser.toString()
    );

    if (chatDeletion && message.createdAt <= chatDeletion.deletedAt) {
      continue;
    }

    const deletedForCurrentUser = message.deletedFor?.some(
      (id) => id.toString() === currentUser.toString()
    );

    if (deletedForCurrentUser) {
      continue;
    }

    if (!lastMessageFound) {
      lastMessage = getMessagePreview(message);
      lastMessageTime = message.createdAt;
      lastMessageFound = true;
    }

    if (
      message.receiver.toString() === currentUser.toString() &&
      message.isRead !== true &&
      !message.isDeletedForEveryone
    ) {
      unreadCount += 1;
    }
  }

  return {
    lastMessage,
    lastMessageTime,
    unreadCount,
  };
};

const getRecentChats = async (req, res) => {
  try {
    const currentUser = req.user.userId;

    const messages = await Message.find({
      // receiver: { $exists: true } excludes group messages, which use
      // `group` instead of `receiver` — without this, a group message
      // reaches this loop with receiver === undefined and crashes when
      // otherUser._id is accessed below.
      receiver: { $exists: true },
      $or: [{ sender: currentUser }, { receiver: currentUser }],
    })
      .sort({ createdAt: -1 })
      .populate("sender", "name username email profileImage bio")
      .populate("receiver", "name username email profileImage bio");

    const chatsMap = new Map();

    for (const message of messages) {
      const isCurrentUserSender =
        message.sender._id.toString() === currentUser.toString();

      const otherUser = isCurrentUserSender
        ? message.receiver
        : message.sender;

      // Defensive fallback: if the other side of a 1:1 message somehow
      // has no populated user (e.g. their account was deleted), skip it
      // rather than crash the whole recent-chats list.
      if (!otherUser) {
        continue;
      }

      const otherUserId = otherUser._id.toString();

      const chatDeletion = message.chatDeletedFor?.find(
        (item) => item.user.toString() === currentUser.toString()
      );

      if (chatDeletion && message.createdAt <= chatDeletion.deletedAt) {
        continue;
      }

      const deletedForCurrentUser = message.deletedFor?.some(
        (id) => id.toString() === currentUser.toString()
      );

      if (deletedForCurrentUser) {
        continue;
      }

      if (!chatsMap.has(otherUserId)) {
        chatsMap.set(otherUserId, {
          user: otherUser,
          lastMessage: getMessagePreview(message),
          lastMessageTime: message.createdAt,
          unreadCount: 0,
        });
      }

      if (
        message.receiver._id.toString() === currentUser.toString() &&
        message.isRead !== true &&
        !message.isDeletedForEveryone
      ) {
        chatsMap.get(otherUserId).unreadCount += 1;
      }
    }

    const chats = Array.from(chatsMap.values());

    return sendSuccess(res, STATUS_CODES.OK, {
      chats,
    });
  } catch (error) {
    console.error("Get recent chats error:", error);

    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

const getChatPreview = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUser = req.user.userId;

    const otherUser = await User.findById(userId);

    if (!otherUser) {
      return sendError(res, STATUS_CODES.NOT_FOUND, MESSAGES.USER_NOT_FOUND);
    }

    const preview = await getChatSummary(currentUser, userId);

    return sendSuccess(res, STATUS_CODES.OK, {
      preview,
    });
  } catch (error) {
    console.error("Get chat preview error:", error);

    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

const deleteChat = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUser = req.user.userId;

    const otherUser = await User.findById(userId);

    if (!otherUser) {
      return sendError(res, STATUS_CODES.NOT_FOUND, MESSAGES.USER_NOT_FOUND);
    }

    const deletedAt = new Date();

    const messages = await Message.find({
      $or: [
        {
          sender: currentUser,
          receiver: userId,
        },
        {
          sender: userId,
          receiver: currentUser,
        },
      ],
    });

    for (const message of messages) {
      const existingDeletion = message.chatDeletedFor?.find(
        (item) => item.user.toString() === currentUser.toString()
      );

      if (existingDeletion) {
        existingDeletion.deletedAt = deletedAt;
      } else {
        message.chatDeletedFor.push({
          user: currentUser,
          deletedAt,
        });
      }

      await message.save();
    }

    return sendSuccess(res, STATUS_CODES.OK, {
      message: MESSAGES.CHAT_DELETED,
    });
  } catch (error) {
    console.error("Delete chat error:", error);

    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

module.exports = {
  getRecentChats,
  getChatPreview,
  deleteChat,
};