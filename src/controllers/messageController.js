const Message = require("../models/Message");
const User = require("../models/User");
const Group = require("../models/Groups");

const STATUS_CODES = require("../constants/statusCodes");
const MESSAGES = require("../constants/messages");

const { sendSuccess, sendError } = require("../utils/response");
const { getIO } = require("../socket/socketInstance");
const { markDeliveredToOnlineMembers } = require("../utils/groupDelivery");

const { uploadToCloudinary } = require("../config/upload");

const sendMessage = async (req, res) => {
  try {
    const { receiver, group, text } = req.body;

    if (!receiver && !group) {
      return sendError(
        res,
        STATUS_CODES.BAD_REQUEST,
        "Receiver or group is required"
      );
    }

    if (receiver && group) {
      return sendError(
        res,
        STATUS_CODES.BAD_REQUEST,
        "A message cannot have both a receiver and a group"
      );
    }

    if (text !== undefined && typeof text !== "string") {
      return sendError(
        res,
        STATUS_CODES.BAD_REQUEST,
        "Message text must be a string"
      );
    }

    if ((!text || text.trim() === "") && !req.file) {
      return sendError(
        res,
        STATUS_CODES.BAD_REQUEST,
        "Message or file is required"
      );
    }

    const sender = req.user.userId;

    // --- 1:1 message path ---
    if (receiver) {
      const receiverUser = await User.findById(receiver);

      if (!receiverUser) {
        return sendError(
          res,
          STATUS_CODES.NOT_FOUND,
          MESSAGES.USER_NOT_FOUND
        );
      }
    }

    // --- Group message path ---
    let groupDoc = null;

    if (group) {
      groupDoc = await Group.findById(group);

      if (!groupDoc) {
        return sendError(res, STATUS_CODES.NOT_FOUND, "Group not found");
      }

      const isMember = groupDoc.members.some(
        (memberId) => memberId.toString() === sender.toString()
      );

      if (!isMember) {
        return sendError(
          res,
          STATUS_CODES.FORBIDDEN,
          "You are not a member of this group"
        );
      }
    }

    let messageType = "text";
    let fileUrl = null;
    let fileName = null;
    let fileSize = null;

    if (req.file) {
      const isImage = req.file.mimetype.startsWith("image/");
      const isVideo = req.file.mimetype.startsWith("video/");
      const isAudio = req.file.mimetype.startsWith("audio/");

      messageType = isImage
        ? "image"
        : isVideo
        ? "video"
        : isAudio
        ? "audio"
        : "file";

      const uploadResult = await uploadToCloudinary(
        req.file.buffer,
        "chat-app/messages",
        `msg-${sender}-${Date.now()}`,
        req.file.mimetype
      );

      fileUrl = uploadResult.secure_url;
      fileName = req.file.originalname;
      fileSize = req.file.size;
    }

    const message = await Message.create({
      sender,
      // Only one of these will be set — Message's pre-validate hook
      // enforces that, so leaving the other undefined here is intentional.
      receiver: receiver || undefined,
      group: group || undefined,
      text: text?.trim() || "",
      messageType,
      fileUrl,
      fileName,
      fileSize,
    });

    await message.populate("sender", "name username profileImage");

    // Group: record which members are online right now as "delivered".
    // Must happen BEFORE emitting, so everyone gets deliveredTo with the message.
    if (groupDoc) {
      try {
        await markDeliveredToOnlineMembers(message, groupDoc);
      } catch (deliveryError) {
        console.error("Group delivery error:", deliveryError);
      }
    }

    try {
      const io = getIO();

      if (receiver) {
        io.to(receiver.toString()).emit("new_message", { message });
        // Also notify the sender's own sockets so ChatList and any other
        // open tab/device updates in real time
        io.to(sender.toString()).emit("new_message", { message });
      } else {
        // The sender is a member of the group room, so they receive this too
        io.emitToGroup(group.toString(), "new_message", { message });
      }
    } catch (socketError) {
      console.error("Socket notification error:", socketError);
    }

    return sendSuccess(res, STATUS_CODES.CREATED, { message });
  } catch (error) {
    console.error("Send message error:", error);
    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

const sendLocationMessage = async (req, res) => {
  try {
    const {
      receiver,
      group,
      latitude,
      longitude,
      isLive,
      liveDurationMinutes,
    } = req.body;

    if (!receiver && !group) {
      return sendError(
        res,
        STATUS_CODES.BAD_REQUEST,
        "Receiver or group is required"
      );
    }

    if (receiver && group) {
      return sendError(
        res,
        STATUS_CODES.BAD_REQUEST,
        "A message cannot have both a receiver and a group"
      );
    }

    const lat = Number(latitude);
    const lng = Number(longitude);

    if (
      latitude === undefined ||
      longitude === undefined ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      Math.abs(lat) > 90 ||
      Math.abs(lng) > 180
    ) {
      return sendError(
        res,
        STATUS_CODES.BAD_REQUEST,
        "Valid latitude and longitude are required"
      );
    }

    const sender = req.user.userId;

    if (receiver) {
      const receiverUser = await User.findById(receiver);

      if (!receiverUser) {
        return sendError(
          res,
          STATUS_CODES.NOT_FOUND,
          MESSAGES.USER_NOT_FOUND
        );
      }
    }

    let groupDoc = null;

    if (group) {
      groupDoc = await Group.findById(group);

      if (!groupDoc) {
        return sendError(res, STATUS_CODES.NOT_FOUND, "Group not found");
      }

      const isMember = groupDoc.members.some(
        (memberId) => memberId.toString() === sender.toString()
      );

      if (!isMember) {
        return sendError(
          res,
          STATUS_CODES.FORBIDDEN,
          "You are not a member of this group"
        );
      }
    }

    const live = Boolean(isLive);
    const duration = Number(liveDurationMinutes);
    const now = new Date();

    let liveExpiresAt = null;

    if (live) {
      if (![15, 60, 480].includes(duration)) {
        return sendError(
          res,
          STATUS_CODES.BAD_REQUEST,
          "Invalid live duration"
        );
      }

      liveExpiresAt = new Date(now.getTime() + duration * 60000);
    }

    const message = await Message.create({
      sender,
      receiver: receiver || undefined,
      group: group || undefined,
      messageType: "location",
      location: {
        latitude: lat,
        longitude: lng,
        isLive: live,
        liveDurationMinutes: live ? duration : undefined,
        liveExpiresAt: live ? liveExpiresAt : undefined,
        lastUpdatedAt: now,
      },
    });

    await message.populate("sender", "name username profileImage");

    if (groupDoc) {
      try {
        await markDeliveredToOnlineMembers(message, groupDoc);
      } catch (deliveryError) {
        console.error("Group delivery error:", deliveryError);
      }
    }

    try {
      const io = getIO();

      if (receiver) {
        io.to(receiver.toString()).emit("new_message", { message });
        io.to(sender.toString()).emit("new_message", { message });
      } else {
        io.emitToGroup(group.toString(), "new_message", { message });
      }
    } catch (socketError) {
      console.error("Socket notification error:", socketError);
    }

    return sendSuccess(res, STATUS_CODES.CREATED, { message });
  } catch (error) {
    console.error("Send location message error:", error);
    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

const getMessages = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUser = req.user.userId;
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const before = req.query.before;

    const chatDeletedMessages = await Message.find({
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
      chatDeletedFor: {
        $elemMatch: {
          user: currentUser,
        },
      },
    }).select("chatDeletedFor createdAt");

    let chatDeletedAt = null;

    for (const message of chatDeletedMessages) {
      const deletion = message.chatDeletedFor?.find(
        (item) => item.user.toString() === currentUser.toString()
      );

      if (deletion) {
        if (!chatDeletedAt || deletion.deletedAt > chatDeletedAt) {
          chatDeletedAt = deletion.deletedAt;
        }
      }
    }

    const query = {
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
      deletedFor: { $ne: currentUser },
      isDeletedForEveryone: { $ne: true },
    };

    if (chatDeletedAt) {
      query.createdAt = { $gt: chatDeletedAt };
    }

    if (before) {
      const beforeDate = new Date(before);

      if (!isNaN(beforeDate.getTime())) {
        query.createdAt = query.createdAt
          ? {
              ...query.createdAt,
              $lt: beforeDate,
            }
          : {
              $lt: beforeDate,
            };
      }
    }

    const messages = await Message.find(query)
      .sort({ createdAt: -1 })
      .limit(limit + 1);

    const hasMore = messages.length > limit;

    const paginatedMessages = hasMore ? messages.slice(0, limit) : messages;

    paginatedMessages.reverse();

    return sendSuccess(res, STATUS_CODES.OK, {
      messages: paginatedMessages,
      hasMore,
    });
  } catch (error) {
    console.error("Get messages error:", error);

    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

const deleteMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { deleteFor } = req.body;
    const currentUser = req.user.userId;

    const message = await Message.findById(messageId);

    if (!message) {
      return sendError(
        res,
        STATUS_CODES.NOT_FOUND,
        MESSAGES.MESSAGE_NOT_FOUND
      );
    }

    const isGroupMessage = Boolean(message.group);
    const isSender = message.sender.toString() === currentUser.toString();

    if (deleteFor === "me") {
      let allowed;

      if (isGroupMessage) {
        // Any current member of the group may delete a message "for me"
        allowed = Boolean(
          await Group.exists({ _id: message.group, members: currentUser })
        );
      } else {
        allowed =
          isSender || message.receiver?.toString() === currentUser.toString();
      }

      if (!allowed) {
        return sendError(
          res,
          STATUS_CODES.FORBIDDEN,
          MESSAGES.CANNOT_DELETE_MESSAGE
        );
      }

      const alreadyDeleted = message.deletedFor.some(
        (id) => id.toString() === currentUser.toString()
      );

      if (!alreadyDeleted) {
        message.deletedFor.push(currentUser);
        await message.save();
      }

      try {
        const io = getIO();

        // Only the deleter's own sockets are told
        io.to(currentUser.toString()).emit("message_deleted", {
          messageId: message._id,
          deleteFor: "me",
          sender: message.sender,
          receiver: message.receiver,
          group: message.group,
        });
      } catch (socketError) {
        console.error("Socket notification error:", socketError);
      }

      return sendSuccess(res, STATUS_CODES.OK, {
        message: "Message deleted for you",
        deleteFor: "me",
        messageId: message._id,
      });
    }

    if (deleteFor === "everyone") {
      if (!isSender) {
        return sendError(
          res,
          STATUS_CODES.FORBIDDEN,
          MESSAGES.CANNOT_DELETE_MESSAGE
        );
      }

      message.isDeletedForEveryone = true;
      message.deletedAt = new Date();
      await message.save();

      try {
        const io = getIO();

        if (isGroupMessage) {
          io.emitToGroup(message.group.toString(), "message_deleted", {
            messageId: message._id,
            deleteFor: "everyone",
            sender: message.sender,
            group: message.group,
          });
        } else {
          io.to(message.receiver.toString()).emit("message_deleted", {
            messageId: message._id,
            deleteFor: "everyone",
            sender: message.sender,
            receiver: message.receiver,
          });
          io.to(message.sender.toString()).emit("message_deleted", {
            messageId: message._id,
            deleteFor: "everyone",
            sender: message.sender,
            receiver: message.receiver,
          });
        }
      } catch (socketError) {
        console.error("Socket notification error:", socketError);
      }

      return sendSuccess(res, STATUS_CODES.OK, {
        message: "Message deleted for everyone",
        deleteFor: "everyone",
        messageId: message._id,
      });
    }

    return sendError(res, STATUS_CODES.BAD_REQUEST, "Invalid delete option");
  } catch (error) {
    console.error("Delete message error:", error);
    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

const markMessagesAsRead = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUser = req.user.userId;

    const result = await Message.updateMany(
      {
        sender: userId,
        receiver: currentUser,
        isRead: { $ne: true },
        deletedFor: { $ne: currentUser },
      },
      {
        $set: { isRead: true },
      }
    );

    if (result.modifiedCount > 0) {
      try {
        const io = getIO();

        io.to(userId.toString()).emit("messages_read", {
          userId: currentUser.toString(),
        });
      } catch (socketError) {
        console.error("Socket read receipt error:", socketError);
      }
    }

    return sendSuccess(res, STATUS_CODES.OK, {
      message: "Message marked as read",
      modifiedCount: result.modifiedCount,
    });
  } catch (error) {
    console.error("Mark messages as read error:", error);
    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

const editMessage = async (req, res) => {
  try {
    const { messageId } = req.params;
    const { text } = req.body;
    const currentUser = req.user.userId;

    if (typeof text !== "string" || text.trim() === "") {
      return sendError(
        res,
        STATUS_CODES.BAD_REQUEST,
        MESSAGES.MESSAGE_TEXT_REQUIRED
      );
    }

    const message = await Message.findById(messageId);

    if (!message) {
      return sendError(
        res,
        STATUS_CODES.NOT_FOUND,
        MESSAGES.MESSAGE_NOT_FOUND
      );
    }

    if (message.sender.toString() !== currentUser.toString()) {
      return sendError(
        res,
        STATUS_CODES.FORBIDDEN,
        MESSAGES.CANNOT_EDIT_MESSAGE
      );
    }

    // The UI only offers Edit on text messages; enforce it on the server too
    if (message.messageType !== "text" || message.isDeletedForEveryone) {
      return sendError(
        res,
        STATUS_CODES.BAD_REQUEST,
        "Only text messages can be edited"
      );
    }

    message.text = text.trim();
    message.isEdited = true;
    await message.save();
    await message.populate("sender", "name username profileImage");

    try {
      const io = getIO();

      if (message.group) {
        io.emitToGroup(message.group.toString(), "message_edited", {
          message,
        });
      } else {
        io.to(message.receiver.toString()).emit("message_edited", { message });
        io.to(message.sender.toString()).emit("message_edited", { message });
      }
    } catch (socketError) {
      console.error("Socket notification error:", socketError);
    }

    return sendSuccess(res, STATUS_CODES.OK, {
      message: "Message edited successfully",
      updatedMessage: message,
    });
  } catch (error) {
    console.error("Edit message error:", error);
    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

module.exports = {
  sendMessage,
  sendLocationMessage,
  getMessages,
  deleteMessage,
  markMessagesAsRead,
  editMessage,
};