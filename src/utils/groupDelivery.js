const Group = require("../models/Groups");
const Message = require("../models/Message");
const { getIO } = require("../socket/socketInstance");

// A user is online when at least one socket is in their personal room
// (the same room you emit "group_created" to: io.to(userId))
const isUserOnline = (io, userId) =>
  (io.sockets.adapter.rooms.get(userId.toString())?.size || 0) > 0;

/**
 * Call right after a group message is created, BEFORE you emit "new_message"
 * and before you send the HTTP response.
 *
 * Records which members are online right now as "delivered" and puts that
 * list on the message, so the sender's screen gets it together with the message.
 *
 * @param message  the created message (mongoose doc)
 * @param group    the group doc (members can be ids or populated objects)
 */
const markDeliveredToOnlineMembers = async (message, group) => {
  const io = getIO();

  const senderId = (message.sender?._id || message.sender).toString();

  const onlineMemberIds = group.members
    .map((member) => (member._id || member).toString())
    .filter((id) => id !== senderId && isUserOnline(io, id));

  if (!onlineMemberIds.length) return message;

  await Message.updateOne(
    { _id: message._id },
    { $addToSet: { deliveredTo: { $each: onlineMemberIds } } }
  );

  message.deliveredTo = onlineMemberIds;

  return message;
};

/**
 * Call when a user's socket connects (after it joined its user room and
 * its group rooms). Everything sent to them while they were offline
 * becomes "delivered" now, and the senders' screens are told.
 */
const markPendingMessagesDelivered = async (userId) => {
  const io = getIO();
  const userIdString = userId.toString();

  const groups = await Group.find({ members: userId }).select("_id");

  if (!groups.length) return;

  const pending = await Message.find({
    group: { $in: groups.map((group) => group._id) },
    sender: { $ne: userId },
    deliveredTo: { $ne: userId },
    isDeletedForEveryone: { $ne: true },
  }).select("_id group");

  if (!pending.length) return;

  await Message.updateMany(
    { _id: { $in: pending.map((message) => message._id) } },
    { $addToSet: { deliveredTo: userId } }
  );

  const idsByGroup = {};

  pending.forEach((message) => {
    const groupId = message.group.toString();

    if (!idsByGroup[groupId]) idsByGroup[groupId] = [];
    idsByGroup[groupId].push(message._id.toString());
  });

  Object.entries(idsByGroup).forEach(([groupId, messageIds]) => {
    io.emitToGroup(groupId, "group_messages_delivered", {
      groupId,
      userId: userIdString,
      messageIds,
    });
  });
};

module.exports = {
  markDeliveredToOnlineMembers,
  markPendingMessagesDelivered,
};