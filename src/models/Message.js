const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // A message belongs to EITHER a 1:1 chat (receiver) OR a group chat
    // (group) — never both. Both are optional at the schema level; the
    // controller enforces that exactly one is set.
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Group",
    },

    text: {
      type: String,
      default: "",
      trim: true,
      
    },

    isDelivered: {
      type: Boolean,
      default: false,
    },

    isRead: {
      type: Boolean,
      default: false,
    },

    // For group chats: which members have read this message. Unused for
    // 1:1 chats, which keep using the simpler isRead boolean above.
    readBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    isPlayed: {
      type: Boolean,
      default: false,
    },

    // For group chats: tracks which members have listened to the audio
    playedBy: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    isEdited: {
      type: Boolean,
      default: false,
    },

    // Delete for me
    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // Delete for everyone
    isDeletedForEveryone: {
      type: Boolean,
      default: false,
    },

    deletedAt: {
      type: Date,
    },

    chatDeletedFor: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },

        deletedAt: {
          type: Date,
        },
      },
    ],
    groupDeletedFor: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        deletedAt: {
          type: Date,
        },
      },
    ],
    messageType: {
      type: String,
      enum: ["text", "image", "video", "file","audio","location"],
      default: "text",
    },
    fileUrl: {
      type: String,
      default: null,
    },
    fileName: {
      type: String,
      default: null,
    },
    fileSize: {
      type: Number,
      default: null,
    },
    location : {
      latitude : { type : Number },
      longitude : { type : Number },
      isLive : { type : Boolean, default : true },
      liveDurationMinutes : { type : Number },
      liveExpiresAt : { type : Date },
      lastUpdatedAt : { type : Date },
    },
  },
  {
    timestamps: true,
  }
);

// Enforce "exactly one of receiver/group" at the model level, so a bug in
// any controller path can't silently create an orphaned or ambiguous
// message.
messageSchema.pre("validate", function () {
  const hasReceiver = Boolean(this.receiver);
  const hasGroup = Boolean(this.group);

  if (hasReceiver === hasGroup) {
    throw new Error("A message must have exactly one of receiver or group");
  }
});

module.exports = mongoose.model("Message", messageSchema);