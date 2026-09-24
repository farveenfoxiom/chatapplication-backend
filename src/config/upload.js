const multer = require("multer");
const cloudinary = require("./cloudinary"); // adjust if cloudinary.js is elsewhere
const streamifier = require("streamifier");

// ---- Multer (memory storage) ----
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = [
    "image/jpeg", "image/png", "image/jpg", "image/webp", "image/gif",
    "video/mp4", "video/quicktime", "video/webm", "video/x-msvideo",
    "audio/mpeg", "audio/mp3", "audio/wav", "audio/ogg", "audio/webm",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/plain",
    "application/zip",
  ];

  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("This file type is not allowed"), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ---- Cloudinary upload helper ----
const getResourceType = (mimetype) => {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  return "raw";
};

const uploadToCloudinary = (fileBuffer, folder, publicId, mimetype) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder,
        public_id: publicId,
        resource_type: getResourceType(mimetype),
      },
      (error, result) => {
        if (error) reject(error);
        else resolve(result);
      }
    );
    streamifier.createReadStream(fileBuffer).pipe(stream);
  });
};

// ---- Export both ----
module.exports = { upload, uploadToCloudinary, getResourceType };