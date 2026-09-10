const Message = require("../models/Message");
const User = require("../models/User");

const STATUS_CODES = require("../constants/statusCodes");
const MESSAGES = require("../constants/messages");

const {sendSuccess,sendError,} = require("../utils/response");
const {getIO} = require("../socket/socketInstance");

const sendMessage = async (req, res) => {
  try {
    const { receiver, text } = req.body;

    if (!receiver || !text || text.trim() === "") {
      return sendError(
        res,
        STATUS_CODES.BAD_REQUEST,
        MESSAGES.RECEIVER_REQUIRED
      );
    }
    const sender = req.user.userId;
    const receiverUser = await User.findById(receiver);
    if (!receiverUser) {
      return sendError(
        res,
        STATUS_CODES.NOT_FOUND,
        MESSAGES.USER_NOT_FOUND
      );
    }
    const message = await Message.create({
      sender,
      receiver,
      text: text.trim(),
    });
    try {
      const io = getIO();
      const receiverRoom = receiver.toString();
      io.to(receiverRoom).emit("new_message", {message,});
    } catch (socketError) {
      console.error(
        "Socket notification error:",
        socketError
      );
    }
    return sendSuccess(
      res,
      STATUS_CODES.CREATED,
      {
        message,
      }
    );
  } catch (error) {
    console.error(
      "Send message error:",
      error
    );
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
      deletedFor: {$ne: currentUser,},
      isDeletedForEveryone: {$ne: true,},
    }).sort({ createdAt: 1 });
    let chatDeletedAt = null;
    for (const message of messages) {
      const deletion = message.chatDeletedFor?.find(
        (item) =>
          item.user.toString() === currentUser.toString()
      );
      if (deletion) {
        if (
          !chatDeletedAt ||
          deletion.deletedAt > chatDeletedAt
        ) {
          chatDeletedAt = deletion.deletedAt;
        }
      }
    }

    const visibleMessages = messages.filter((message) => {
      if (
        chatDeletedAt &&
        message.createdAt <= chatDeletedAt
      ) {
        return false;
      }
      return true;
    });
    return sendSuccess(
      res,
      STATUS_CODES.OK,{
        messages : visibleMessages
      }
    );
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
    if (deleteFor === "me") {
      const isSender = 
        message.sender.toString() === 
        currentUser.toString(); 
      const isReceiver = 
        message.receiver.toString() === 
        currentUser.toString(); 
      if (!isSender && !isReceiver) { 
        return sendError( 
          res, 
          STATUS_CODES.FORBIDDEN, 
          MESSAGES.CANNOT_DELETE_MESSAGE 
        ); 
      } 
      const alreadyDeleted = 
        message.deletedFor.some( 
          (id) => 
            id.toString() === 
            currentUser.toString() 
        ); 
      if (!alreadyDeleted) { 
        message.deletedFor.push(currentUser); 
        await message.save(); 
      } 
      try {
        const io = getIO();
        io.to(currentUser.toString()).emit("message_deleted", {
          messageId: message._id,
          deleteFor: "me",
          sender: message.sender,
          receiver: message.receiver,
        });
      } catch (socketError) {
        console.error(
          "Socket notification error:",
          socketError
        );
      }
      return sendSuccess( 
        res, 
        STATUS_CODES.OK, 
        { 
          message: "Message deleted for you", 
          deleteFor: "me", 
          messageId: message._id, 
        } 
      ); 
    } 
    if (deleteFor === "everyone") { 
      const isSender = 
        message.sender.toString() === 
        currentUser.toString(); 
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
        io.to(message.receiver.toString()).emit( 
          "message_deleted", 
          { 
            messageId: message._id, 
            deleteFor: "everyone", 
            sender: message.sender, 
            receiver: message.receiver, 
          } 
        ); 
        io.to(message.sender.toString()).emit( 
          "message_deleted", 
          { 
            messageId: message._id, 
            deleteFor: "everyone", 
            sender: message.sender, 
            receiver: message.receiver, 
          } 
        ); 
      } catch (socketError) { 
        console.error( 
          "Socket notification error:", 
          socketError 
        ); 
      } 
      return sendSuccess( 
        res, 
        STATUS_CODES.OK, 
        { 
          message: "Message deleted for everyone", 
          deleteFor: "everyone", 
          messageId: message._id, 
        } 
      ); 
    } 
    return sendError( 
      res, 
      STATUS_CODES.BAD_REQUEST, 
      "Invalid delete option" 
    ); 
  } catch (error) { 
    console.error( 
      "Delete message error:", 
      error 
    ); 
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
        isRead: {$ne: true,},
        deletedFor: {$ne: currentUser,},
      },
      {
        $set: {isRead: true,},
      }
    );
    return sendSuccess(
      res,
      STATUS_CODES.OK,{
        message : "Message marked as read",
        modifiedCount : result.modifiedCount,
      }
    );
  } catch (error) {
    console.error(
      "Mark messages as read error:",
      error
    );
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
    if (!text || text.trim() === "") {
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
    if (
      message.sender.toString() !==
      currentUser.toString()
    ) {
      return sendError(
        res,
        STATUS_CODES.FORBIDDEN,
        MESSAGES.CANNOT_EDIT_MESSAGE
      );
    }
    message.text = text.trim();
    message.isEdited = true;
    await message.save();
    const io = getIO();
    io.to(message.receiver.toString()).emit(
      "message_edited",{
        message
      }
    );
    io.to(message.sender.toString()).emit(
      "message_edited",{
        message
      }
    );
    return sendSuccess(
      res,
      STATUS_CODES.OK,{
        message : "Message edited successfully",
        updatedMessage : message
      }
    );
  } catch (error) {
    console.error("Edit message error:", error);
    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

module.exports = {sendMessage,getMessages,deleteMessage,markMessagesAsRead,editMessage};