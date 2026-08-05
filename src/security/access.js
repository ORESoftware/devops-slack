export function isAllowed({ userId, channelId, allowedUserIds, allowedChannelIds }) {
  const userAllowed = allowedUserIds.size === 0 || allowedUserIds.has(userId);
  const channelAllowed = allowedChannelIds.size === 0 || allowedChannelIds.has(channelId);
  return userAllowed && channelAllowed;
}
