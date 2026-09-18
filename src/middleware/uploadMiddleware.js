const multer = require("multer");
const path = require("path");

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },

  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname);
    const fileName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${extension}`;

    cb(null, fileName);
  },
});

const upload = multer({
  storage,
  limits: {
    // Videos are much larger than images/docs, so the old flat 5MB cap
    // rejected every recording before it even reached fileFilter. Bump
    // this to match (or exceed) the client's video size cap.
    fileSize: 50 * 1024 * 1024, // 50 MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimeTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/webp",
      "image/gif",
      "video/webm",
      "video/mp4",
      "video/quicktime", // .mov
      "video/x-msvideo", // .avi
      "video/x-matroska", // .mkv
      "video/3gpp",
      // Some browsers/recorders report a generic type for recorded blobs;
      // the extension check below is the real safety net for those cases.
      "application/octet-stream",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/zip",
    ];

    const allowedExtensions = [
      ".jpg",
      ".jpeg",
      ".png",
      ".webp",
      ".gif",
      ".mp4",
      ".webm",
      ".mov",
      ".avi",
      ".mkv",
      ".3gp",
      ".pdf",
      ".doc",
      ".docx",
      ".xls",
      ".xlsx",
      ".zip",
    ];

    const extension = path.extname(file.originalname).toLowerCase();

    console.log("File name:", file.originalname);
    console.log("MIME type:", file.mimetype);
    console.log("Extension:", extension);

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

module.exports = upload;