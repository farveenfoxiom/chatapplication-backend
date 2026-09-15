require("dotenv").config();

const http = require("http");

const app = require("./app");
const connectDB = require("./config/db");

const initializeSocket = require("./socket/socket");
const { setIO } = require("./socket/socketInstance");

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

const io = initializeSocket(server);
setIO(io);

const startServer = async () => {
  try {
    await connectDB();

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Server failed to start", error);
  }
};

startServer();