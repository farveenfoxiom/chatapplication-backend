const express = require("express");
const cors = require("cors");
const path = require("path");

const routes = require("./routes");

const app = express();

app.use(cors({
  origin:process.env.CLIENT_URL,
  credentials : true
}));
app.use(express.json());

app.use(
  "/uploads",
  express.static(path.join(__dirname, "../uploads"))
);

app.get("/", (req, res) => {
  res.json({
    message: "ChatFlow API is working",
  });
});

app.use("/api", routes);

module.exports = app;