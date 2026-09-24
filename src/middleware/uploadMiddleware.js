const multer = require("multer");
const path = require("path");
const cloudinary = require("./cloudinary"); // adjust path if cloudinary.js lives elsewhere
const streamifier = require("streamifier");

// ---- Multer (memory storage — no disk writes) ----
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50 MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "image/gif",

      "audio/webm",
      "audio/ogg",
      "audio/mpeg",
      "audio/mp4",
      "audio/wav",
      "audio/x-wav",

      "video/webm",
      "video/mp4",
      "video/quicktime",
      "video/x-msvideo",
      "video/x-matroska",
      "video/3gpp",
      "application/octet-stream",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/zip",
    ];

    const allowedExtensions = [
      ".jpg", ".jpeg", ".png", ".webp", ".gif",
      ".mp4", ".webm", ".ogg", ".mp3", ".wav",
      ".mov", ".avi", ".mkv", ".3gp",
      ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".zip",
    ];

    const extension = path.extname(file.originalname).toLowerCase();

    if (
      allowedMimeTypes.includes(file.mimetype) ||
      allowedExtensions.includes(extension)
    ) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type"));
    }
  },
});

// ---- Cloudinary upload helper ----
const getResourceType = (mimetype) => {
  if (mimetype.startsWith("image/")) return "image";
  if (mimetype.startsWith("video/")) return "video";
  return "raw"; // audio, pdf, docx, zip, etc.
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

module.exports = { upload, uploadToCloudinary, getResourceType };