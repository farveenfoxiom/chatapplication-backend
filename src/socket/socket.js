const { Server } = require("socket.io");

const jwt = require("jsonwebtoken");

const User = require("../models/User");
const Message = require("../models/Message");
const Group = require("../models/Groups");

const onlineUsers = new Map();

const offlineTimers = new Map();

const initializeSocket = (server) => {
  const io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL,
      credentials: true,
    },
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token;

      if (!token) {
        return next(new Error("Authentication required"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.userId.toString();
      next();
    } catch (error) {
      console.error("Socket authentication error:", error.message);
      next(new Error("Invalid or expired token"));
    }
  });

  const emitToUser = (userId, event, payload) => {
    io.to(userId.toString()).emit(event, payload);
  };

  const emitToGroup = (groupId, event, payload) => {
    io.to(`group:${groupId}`).emit(event, payload);
  };

  const joinMembersToGroupRoom = (groupId, memberIds) => {
    memberIds.forEach((memberId) => {
      const socketIds = onlineUsers.get(memberId.toString());
      if (!socketIds) return;

      socketIds.forEach((socketId) => {
        const memberSocket = io.sockets.sockets.get(socketId);
        memberSocket?.join(`group:${groupId}`);
      });
    });
  };

  const leaveMemberFromGroupRoom = (groupId, memberId) => {
    const socketIds = onlineUsers.get(memberId.toString());
    if (!socketIds) return;

    socketIds.forEach((socketId) => {
      const memberSocket = io.sockets.sockets.get(socketId);
      memberSocket?.leave(`group:${groupId}`);
    });
  };

  io.emitToUser = emitToUser;
  io.emitToGroup = emitToGroup;
  io.joinMembersToGroupRoom = joinMembersToGroupRoom;
  io.leaveMemberFromGroupRoom = leaveMemberFromGroupRoom;

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

    try {
      const userGroups = await Group.find({
        members: socket.userId,
      }).select("_id");

      userGroups.forEach((group) => {
        socket.join(`group:${group._id}`);
      });
    } catch (error) {
      console.error("Group room auto-join error:", error);
    }

    const undeliveredMessages = await Message.find({
      receiver: socket.userId,
      isDelivered: false,
      deletedFor: { $ne: socket.userId },
    });

    for (const message of undeliveredMessages) {
      message.isDelivered = true;
      await message.save();

      io.to(message.sender.toString()).emit("message_delivered", {
        messageId: message._id,
      });
    }

    socket.on("message_delivered", async (messageId) => {
      try {
        const message = await Message.findById(messageId);

        if (!message) return;
        if (message.receiver?.toString() !== socket.userId.toString()) return;
        if (message.isDelivered) return;

        message.isDelivered = true;
        await message.save();

        io.to(message.sender.toString()).emit("message_delivered", {
          messageId: message._id,
        });
      } catch (error) {
        console.error("Message delivery error:", error);
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
        console.error("Check online status error:", error);
      }
    });

    socket.on("join_group", (groupId) => {
      socket.join(`group:${groupId}`);
    });

    socket.on("leave_group", (groupId) => {
      socket.leave(`group:${groupId}`);
    });
    
    socket.on("send_location_update", async ({ messageId, latitude, longitude }) => {
      try {
        const message = await Message.findById(messageId);

        if (!message) return;
        if (message.messageType !== "location") return;
        if (message.sender.toString() !== socket.userId.toString()) return;
        if (!message.location?.isLive) return;

        if (
          message.location.liveExpiresAt &&
          new Date() > message.location.liveExpiresAt
        ) {
          return;
        }

        message.location.latitude = latitude;
        message.location.longitude = longitude;
        message.location.lastUpdatedAt = new Date();

        await message.save();

        const payload = {
          messageId: message._id,
          latitude,
          longitude,
          lastUpdatedAt: message.location.lastUpdatedAt,
        };

        if (message.group) {
          io.emitToGroup(message.group.toString(), "location_update", payload);
        } else {
          io.to(message.receiver.toString()).emit("location_update", payload);
          io.to(message.sender.toString()).emit("location_update", payload);
        }
      } catch (error) {
        console.error("Send location update error:", error);
      }
    });

    socket.on("stop_location_share", async ({ messageId }) => {
      try {
        const message = await Message.findById(messageId);

        if (!message) return;
        if (message.messageType !== "location") return;
        if (message.sender.toString() !== socket.userId.toString()) return;

        message.location.isLive = false;
        await message.save();

        const payload = { messageId: message._id };

        if (message.group) {
          io.emitToGroup(message.group.toString(), "location_share_stopped", payload);
        } else {
          io.to(message.receiver.toString()).emit("location_share_stopped", payload);
          io.to(message.sender.toString()).emit("location_share_stopped", payload);
        }
      } catch (error) {
        console.error("Stop location share error:", error);
      }
    });

    socket.on("disconnect", () => {
      const userSockets = onlineUsers.get(socket.userId);

      if (!userSockets) return;

      userSockets.delete(socket.id);

      if (userSockets.size > 0) return;

      const timer = setTimeout(async () => {
        const currentSockets = onlineUsers.get(socket.userId);

        if (!currentSockets || currentSockets.size === 0) {
          onlineUsers.delete(socket.userId);

          try {
            await User.findByIdAndUpdate(socket.userId, {
              lastSeen: new Date(),
            });
          } catch (error) {
            console.error("Last seen update error:", error);
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