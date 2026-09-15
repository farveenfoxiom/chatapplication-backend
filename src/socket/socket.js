const {Server,} = require("socket.io");

const jwt = require("jsonwebtoken");

const User = require("../models/User");
const Message = require("../models/Message");

const onlineUsers = new Map();
const offlineTimers = new Map();

const initializeSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin:
        process.env.CLIENT_URL,
      credentials: true,
    },
  });

  io.use(
    (socket, next) => {
      try {
        const token =socket.handshake.auth?.token;
        if (!token) {
          return next(
            new Error("Authentication required" ));
        }
        const decoded =jwt.verify(token,process.env.JWT_SECRET);
        socket.userId =decoded.userId.toString();
        next();
      } catch (error) {
        console.error("Socket authentication error:",error.message);
        next(new Error("Invalid or expired token"));
      }
    }
  );

  io.on("connection", async (socket) => {
    socket.join(socket.userId);
    const existingTimer = offlineTimers.get(socket.userId);
    if (existingTimer) {
      clearTimeout(existingTimer);
      offlineTimers.delete(socket.userId);
    }
    if (!onlineUsers.has(socket.userId)) {
      onlineUsers.set(socket.userId, new Set());
      socket.broadcast.emit("user_online", {
        userId: socket.userId,
      });
    }
    onlineUsers.get(socket.userId).add(socket.id);
    const undeliveredMessages = await Message.find({
      receiver: socket.userId,
      isDelivered: false,
      deletedFor: {$ne: socket.userId,},
    });
    for (const message of undeliveredMessages) {
      message.isDelivered = true;
      await message.save();
      io.to(message.sender.toString()).emit(
        "message_delivered",
        {
          messageId: message._id,
        }
      );
    }
    socket.on("message_delivered", async (messageId) => {
      try {
        const message = await Message.findById(messageId);
        if (!message) return;
        if (
          message.receiver.toString() !==
          socket.userId.toString()
        ) {
          return;
        }
        if (message.isDelivered) return;
        message.isDelivered = true;
        await message.save();
        io.to(message.sender.toString()).emit(
          "message_delivered",
          {
            messageId: message._id,
          }
        );
      } catch (error) {
        console.error(
          "Message delivery error:",
          error
        );
      }
    });

    socket.on("check_user_online", async (userId) => {
      try {
        const targetUserId = userId.toString();
        const isOnline = onlineUsers.has(targetUserId);
        const user = await User.findById(targetUserId).select("lastSeen");
        socket.emit("user_online_status", {
          userId: targetUserId,
          isOnline,
          lastSeen: user?.lastSeen || null,
        });
      } catch (error) {
        console.error("Check online status error:",error);
      }
    });
    socket.on("disconnect", () => {
      const userSockets = onlineUsers.get(socket.userId);
      if (!userSockets) {
        return;
      }
      userSockets.delete(socket.id);
      if (userSockets.size > 0) {
        return;
      }
      const timer = setTimeout(async () => {
        const currentSockets = onlineUsers.get(socket.userId);
        if (!currentSockets || currentSockets.size === 0) {
          onlineUsers.delete(socket.userId);
          try {
            await User.findByIdAndUpdate(
              socket.userId,
              {
                lastSeen: new Date(),
              }
            );
          } catch (error) {
            console.error(
              "Last seen update error:",
              error
            );
          }
          socket.broadcast.emit("user_offline", {
            userId: socket.userId,
            lastSeen: new Date(),
          });
        }
        offlineTimers.delete(socket.userId);
      }, 1000);
      offlineTimers.set(socket.userId, timer);
    });
  });
  return io;
};

module.exports = initializeSocket;