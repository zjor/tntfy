/**
 * MarkdownV2 reserves these chars; literal use requires a backslash escape.
 * Per Telegram Bot API: _*[]()~`>#+-=|{}.!\
 */
const MD_V2_SPECIAL = /[_*[\]()~`>#+\-=|{}.!\\]/g;

export function escapeMarkdownV2(s: string): string {
  return s.replace(MD_V2_SPECIAL, '\\$&');
}

/**
 * Prepend the topic name to a text message so the recipient can tell which
 * topic the notification came from. Header style matches the parse mode.
 */
export function formatText(
  topic: string,
  body: string,
  parseMode: 'none' | 'MarkdownV2' | 'HTML',
): string {
  if (parseMode === 'MarkdownV2') {
    return `*${escapeMarkdownV2(topic)}*\n\n${body}`;
  }
  if (parseMode === 'HTML') {
    return `<b>${topic}</b>\n\n${body}`;
  }
  return `${topic}\n\n${body}`;
}

/**
 * Build the caption used when forwarding image/file payloads. Telegram does
 * not parse_mode the caption here, so the topic appears as plain text.
 */
export function formatCaption(topic: string, userCaption?: string): string {
  if (!userCaption) return topic;
  return `${topic}\n${userCaption}`;
}
