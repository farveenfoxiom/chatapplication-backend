const {Server,} = require("socket.io");

const jwt = require("jsonwebtoken");

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

  io.on("connection", (socket) => {
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
    socket.on("check_user_online", (userId) => {
      const targetUserId = userId.toString();
      const isOnline = onlineUsers.has(targetUserId);
      socket.emit("user_online_status", {
        userId: targetUserId,
        isOnline,
      });
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
      const timer = setTimeout(() => {
        const currentSockets = onlineUsers.get(socket.userId);
        if (!currentSockets || currentSockets.size === 0) {
          onlineUsers.delete(socket.userId);
          socket.broadcast.emit("user_offline", {
            userId: socket.userId,
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