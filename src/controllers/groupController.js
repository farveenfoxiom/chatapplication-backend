const Group = require("../models/Groups");
const Message = require("../models/Message");

const STATUS_CODES = require("../constants/statusCodes");
const MESSAGES = require("../constants/messages");

const { sendSuccess, sendError } = require("../utils/response");
const { getIO } = require("../socket/socketInstance");

const createGroup = async (req,res) => {
  try {
    const { name,memberIds } = req.body;
    const currentUserId = req.user.userId;

    if (!name?.trim()) {
      return sendError(
        res,
        STATUS_CODES.BAD_REQUEST,
        "Group name is required"
      );
    }

    if (!Array.isArray(memberIds) || memberIds.length < 2) {
      return sendError(
        res,
        STATUS_CODES.BAD_REQUEST,
        "A group needs at least 2 other members"
      );
    }

    const uniqueMemberIds = Array.from(
      new Set([...memberIds,currentUserId.toString()])
    );

    const group = await Group.create({
      name: name.trim(),
      members: uniqueMemberIds,
      admins: [currentUserId],
      createdBy: currentUserId,
    });

    const populatedGroup = await Group.findById(group._id)
      .populate("members","name username profileImage")
      .populate("admins","name username profileImage");

    try {
      const io = getIO();

      io.joinMembersToGroupRoom(
        group._id.toString(),
        uniqueMemberIds
      );

      uniqueMemberIds.forEach((memberId) => {
        io.to(memberId.toString()).emit("group_created",{
          group: populatedGroup,
        });
      });
    } catch (socketError) {
      console.error("Socket notification error:",socketError);
    }

    return sendSuccess(res,STATUS_CODES.CREATED,{
      group: populatedGroup,
    });
  } catch (error) {
    console.error("Create group error:",error);

    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

const getUserGroups = async (req,res) => {
  try {
    const currentUserId = req.user.userId;

    const groups = await Group.find({
      members: currentUserId,
    })
      .populate("members","name username profileImage")
      .populate("admins","name username profileImage")
      .sort({updatedAt:-1});

    const groupsWithUnread = await Promise.all(
      groups.map(async (group) => {
        const unreadCount = await Message.countDocuments({
          group: group._id,
          sender: { $ne: currentUserId },
          readBy: { $ne: currentUserId },
          isDeletedForEveryone: { $ne: true },
          deletedFor: { $ne: currentUserId },
          groupDeletedFor: {
            $not: {
              $elemMatch: {
                user: currentUserId,
              },
            },
          },
        });

        const lastMessage = await Message.findOne({
          group: group._id,
          deletedFor: { $ne: currentUserId },
          groupDeletedFor: {
            $not: {
              $elemMatch: {
                user: currentUserId,
              },
            },
          },
          isDeletedForEveryone: { $ne: true },
        })
          .sort({createdAt:-1})
          .populate("sender","name profileImage");
        return {
          ...group.toObject(),
          unreadCount,
          lastMessage: lastMessage || null,
          lastMessageTime: lastMessage?.createdAt || group.updatedAt,
        };
      })
    );

    return sendSuccess(
      res,
      STATUS_CODES.OK,
      {groups: groupsWithUnread}
    );
  } catch (error) {
    console.error("Get user groups error:",error);

    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

const getGroupById = async (req,res) => {
  try {
    const { groupId } = req.params;
    const currentUserId = req.user.userId;

    const group = await Group.findById(groupId)
      .populate("members","name username profileImage")
      .populate("admins","name username profileImage");

    if (!group) {
      return sendError(
        res,
        STATUS_CODES.NOT_FOUND,
        "Group not found"
      );
    }

    const isMember = group.members.some(
      (member) =>
        member._id.toString() === currentUserId.toString()
    );

    if (!isMember) {
      return sendError(
        res,
        STATUS_CODES.FORBIDDEN,
        "Not a member of this group"
      );
    }

    return sendSuccess(res,STATUS_CODES.OK,{group});
  } catch (error) {
    console.error("Get group error:",error);

    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

const updateGroupInfo = async (req,res) => {
  try {
    const { groupId } = req.params;
    const { name,bio } = req.body;
    const currentUserId = req.user.userId;

    const group = await Group.findById(groupId);

    if (!group) {
      return sendError(
        res,
        STATUS_CODES.NOT_FOUND,
        "Group not found"
      );
    }

    const isAdmin = group.admins.some(
      (adminId) =>
        adminId.toString() === currentUserId.toString()
    );

    if (!isAdmin) {
      return sendError(
        res,
        STATUS_CODES.FORBIDDEN,
        "Only group admins can edit group info"
      );
    }

    if (name !== undefined) {
      if (!name.trim()) {
        return sendError(
          res,
          STATUS_CODES.BAD_REQUEST,
          "Group name is required"
        );
      }

      group.name = name.trim();
    }

    if (bio !== undefined) {
      group.bio = bio.trim();
    }

    if (req.file) {
      group.groupImage = `/uploads/${req.file.filename}`;
    }

    await group.save();

    const populatedGroup = await Group.findById(group._id)
      .populate("members","name username profileImage")
      .populate("admins","name username profileImage");

    try {
      const io = getIO();

      io.emitToGroup(groupId,"group_updated",{
        group: populatedGroup,
      });
    } catch (socketError) {
      console.error("Socket notification error:",socketError);
    }

    return sendSuccess(res,STATUS_CODES.OK,{
      group: populatedGroup,
    });
  } catch (error) {
    console.error("Update group info error:",error);

    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

const updateGroupMembers = async (req,res) => {
  try {
    const { groupId } = req.params;
    const { addMemberIds,removeMemberId } = req.body;
    const currentUserId = req.user.userId;

    const group = await Group.findById(groupId);

    if (!group) {
      return sendError(
        res,
        STATUS_CODES.NOT_FOUND,
        "Group not found"
      );
    }

    const isAdmin = group.admins.some(
      (adminId) =>
        adminId.toString() === currentUserId.toString()
    );

    if (!isAdmin) {
      return sendError(
        res,
        STATUS_CODES.FORBIDDEN,
        "Only group admins can manage members"
      );
    }

    let addedIds = [];

    if (Array.isArray(addMemberIds) && addMemberIds.length) {
      const existingIds = group.members.map(
        (id) => id.toString()
      );

      addedIds = addMemberIds.filter(
        (id) => !existingIds.includes(id.toString())
      );

      group.members.push(...addedIds);
    }

    if (removeMemberId) {
      if (
        removeMemberId.toString() ===
        group.createdBy.toString()
      ) {
        return sendError(
          res,
          STATUS_CODES.BAD_REQUEST,
          "Group creator cannot be removed"
        );
      }

      const isMember = group.members.some(
        (id) =>
          id.toString() === removeMemberId.toString()
      );

      if (!isMember) {
        return sendError(
          res,
          STATUS_CODES.BAD_REQUEST,
          "User is not a group member"
        );
      }

      group.members = group.members.filter(
        (id) =>
          id.toString() !== removeMemberId.toString()
      );

      group.admins = group.admins.filter(
        (id) =>
          id.toString() !== removeMemberId.toString()
      );
    }

    if (group.members.length === 0) {
      return sendError(
        res,
        STATUS_CODES.BAD_REQUEST,
        "Group must have at least one member"
      );
    }

    if (group.admins.length === 0) {
      group.admins.push(group.members[0]);
    }

    await group.save();

    const populatedGroup = await Group.findById(group._id)
      .populate("members","name username profileImage")
      .populate("admins","name username profileImage");

    try {
      const io = getIO();

      if (addedIds.length) {
        io.joinMembersToGroupRoom(
          groupId,
          addedIds
        );

        addedIds.forEach((memberId) => {
          io.to(memberId.toString()).emit(
            "group_created",
            {
              group: populatedGroup,
            }
          );
        });
      }

      if (removeMemberId) {
        io.leaveMemberFromGroupRoom(
          groupId,
          removeMemberId
        );
      }

      io.emitToGroup(
        groupId,
        "group_updated",
        {
          group: populatedGroup,
        }
      );
    } catch (socketError) {
      console.error("Socket notification error:",socketError);
    }

    return sendSuccess(res,STATUS_CODES.OK,{
      group: populatedGroup,
    });
  } catch (error) {
    console.error("Update group members error:",error);

    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

const updateGroupAdmins = async (req,res) => {
  try {
    const { groupId } = req.params;
    const { userId,action } = req.body;
    const currentUserId = req.user.userId;

    if (!userId || !["add","remove"].includes(action)) {
      return sendError(
        res,
        STATUS_CODES.BAD_REQUEST,
        "Invalid admin action"
      );
    }

    const group = await Group.findById(groupId);

    if (!group) {
      return sendError(
        res,
        STATUS_CODES.NOT_FOUND,
        "Group not found"
      );
    }

    const isAdmin = group.admins.some(
      (adminId) =>
        adminId.toString() === currentUserId.toString()
    );

    if (!isAdmin) {
      return sendError(
        res,
        STATUS_CODES.FORBIDDEN,
        "Only group admins can manage admins"
      );
    }

    const isMember = group.members.some(
      (memberId) =>
        memberId.toString() === userId.toString()
    );

    if (!isMember) {
      return sendError(
        res,
        STATUS_CODES.BAD_REQUEST,
        "User is not a group member"
      );
    }

    if (action === "add") {
      const alreadyAdmin = group.admins.some(
        (adminId) =>
          adminId.toString() === userId.toString()
      );

      if (!alreadyAdmin) {
        group.admins.push(userId);
      }
    }

    if (action === "remove") {
      if (
        userId.toString() ===
        group.createdBy.toString()
      ) {
        return sendError(
          res,
          STATUS_CODES.BAD_REQUEST,
          "Group creator cannot be removed as admin"
        );
      }

      if (group.admins.length <= 1) {
        return sendError(
          res,
          STATUS_CODES.BAD_REQUEST,
          "Group must have at least one admin"
        );
      }

      group.admins = group.admins.filter(
        (adminId) =>
          adminId.toString() !== userId.toString()
      );
    }

    await group.save();

    const populatedGroup = await Group.findById(group._id)
      .populate("members","name username profileImage")
      .populate("admins","name username profileImage");

    try {
      const io = getIO();

      io.emitToGroup(
        groupId,
        "group_updated",
        {
          group: populatedGroup,
        }
      );
    } catch (socketError) {
      console.error("Socket notification error:",socketError);
    }

    return sendSuccess(res,STATUS_CODES.OK,{
      group: populatedGroup,
    });
  } catch (error) {
    console.error("Update group admins error:",error);

    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

const leaveGroup = async (req,res) => {
  try {
    const { groupId } = req.params;
    const currentUserId = req.user.userId;

    const group = await Group.findById(groupId);

    if (!group) {
      return sendError(
        res,
        STATUS_CODES.NOT_FOUND,
        "Group not found"
      );
    }

    const isMember = group.members.some(
      (id) =>
        id.toString() === currentUserId.toString()
    );

    if (!isMember) {
      return sendError(
        res,
        STATUS_CODES.BAD_REQUEST,
        "You are not a member of this group"
      );
    }

    group.members = group.members.filter(
      (id) =>
        id.toString() !== currentUserId.toString()
    );

    group.admins = group.admins.filter(
      (id) =>
        id.toString() !== currentUserId.toString()
    );

    if (
      group.admins.length === 0 &&
      group.members.length > 0
    ) {
      group.admins.push(group.members[0]);
    }

    await group.save();

    try {
      const io = getIO();

      io.emitToGroup(
        groupId,
        "member_left",
        {
          groupId,
          userId: currentUserId,
        }
      );

      io.leaveMemberFromGroupRoom(
        groupId,
        currentUserId
      );
    } catch (socketError) {
      console.error("Socket notification error:",socketError);
    }

    return sendSuccess(res,STATUS_CODES.OK,{
      message: "Left group successfully",
    });
  } catch (error) {
    console.error("Leave group error:",error);

    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

const getGroupMessages = async (req,res) => {
  try {
    const { groupId } = req.params;
    const currentUserId = req.user.userId;
    const limit = Math.min(parseInt(req.query.limit) || 20,50);
    const before = req.query.before;

    const group = await Group.findById(groupId);

    if (!group) {
      return sendError(
        res,
        STATUS_CODES.NOT_FOUND,
        "Group not found"
      );
    }

    const isMember = group.members.some(
      (id) =>
        id.toString() === currentUserId.toString()
    );

    if (!isMember) {
      return sendError(
        res,
        STATUS_CODES.FORBIDDEN,
        "Not a member of this group"
      );
    }

    const query = {
      group: groupId,
      deletedFor: { $ne: currentUserId },
      groupDeletedFor: {
        $not: {
          $elemMatch: {
            user: currentUserId,
          },
        },
      },
      isDeletedForEveryone: { $ne: true },
    };

    if (before) {
      query.createdAt = {
        $lt: new Date(before),
      };
    }

    const messages = await Message.find(query)
      .populate("sender","name profileImage")
      .sort({createdAt:-1})
      .limit(limit);

    const hasMore = messages.length === limit;

    messages.reverse();

    return sendSuccess(
      res,
      STATUS_CODES.OK,
      {
        messages,
        hasMore,
      }
    );
  } catch (error) {
    console.error("Get group messages error:",error);

    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

const clearGroupChat = async (req,res) => {
  try {
    const { groupId } = req.params;
    const currentUserId = req.user.userId;

    const group = await Group.findById(groupId);

    if (!group) {
      return sendError(
        res,
        STATUS_CODES.NOT_FOUND,
        "Group not found"
      );
    }

    const isMember = group.members.some(
      (id) =>
        id.toString() === currentUserId.toString()
    );

    if (!isMember) {
      return sendError(
        res,
        STATUS_CODES.FORBIDDEN,
        "Not a member of this group"
      );
    }

    const deletedAt = new Date();

    await Message.updateMany(
      {
        group: groupId,
        "groupDeletedFor.user": {
          $ne: currentUserId,
        },
      },
      {
        $push: {
          groupDeletedFor: {
            user: currentUserId,
            deletedAt,
          },
        },
      }
    );

    try {
      const io = getIO();

      io.to(currentUserId.toString()).emit(
        "group_chat_cleared",
        {
          groupId,
        }
      );
    } catch (socketError) {
      console.error("Socket notification error:",socketError);
    }

    return sendSuccess(
      res,
      STATUS_CODES.OK,
      {
        message: "Group chat cleared successfully",
      }
    );
  } catch (error) {
    console.error("Clear group chat error:",error);

    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

const markGroupMessagesAsRead = async (req,res) => {
  try {
    const { groupId } = req.params;
    const currentUserId = req.user.userId;

    const group = await Group.findById(groupId);

    if (!group) {
      return sendError(
        res,
        STATUS_CODES.NOT_FOUND,
        "Group not found"
      );
    }

    const isMember = group.members.some(
      (id) =>
        id.toString() === currentUserId.toString()
    );

    if (!isMember) {
      return sendError(
        res,
        STATUS_CODES.FORBIDDEN,
        "Not a member of this group"
      );
    }

    await Message.updateMany(
      {
        group: groupId,
        sender: { $ne: currentUserId },
        readBy: { $ne: currentUserId },
        isDeletedForEveryone: { $ne: true },
        deletedFor: { $ne: currentUserId },
        groupDeletedFor: {
          $not: {
            $elemMatch: {
              user: currentUserId,
            },
          },
        },
      },
      {
        $addToSet: {
          readBy: currentUserId,
        },
      }
    );
    return sendSuccess(
      res,
      STATUS_CODES.OK,
      {
        message: "Group messages marked as read",
      }
    );
  } catch (error) {
    console.error("Mark group messages as read error:",error);

    return sendError(
      res,
      STATUS_CODES.INTERNAL_SERVER_ERROR,
      MESSAGES.SERVER_ERROR
    );
  }
};

module.exports = {
  createGroup,
  getUserGroups,
  getGroupById,
  updateGroupInfo,
  updateGroupMembers,
  updateGroupAdmins,
  leaveGroup,
  getGroupMessages,
  markGroupMessagesAsRead,
  clearGroupChat,
};