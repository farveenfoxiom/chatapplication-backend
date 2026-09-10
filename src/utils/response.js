const sendSuccess = (res, statusCode, data) => {
  return res.status(statusCode).json(data);
};

const sendError = (res, statusCode, message) => {
  return res.status(statusCode).json({
    message,
  });
};

module.exports = {
  sendSuccess,
  sendError,
};