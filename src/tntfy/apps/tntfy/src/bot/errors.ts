import {
  DuplicateTopicError,
  InvalidTopicNameError,
  TopicNotFoundError,
} from '../topics/errors';
import { TOPIC_NAME_REGEX } from '../topics/topic-name';

export function formatError(err: unknown): string {
  if (err instanceof InvalidTopicNameError) {
    return `topic names must match \`${TOPIC_NAME_REGEX.source}\` — e.g. \`deploys\`, \`app-1\``;
  }
  if (err instanceof DuplicateTopicError) {
    return `you already have a topic '${err.name}'`;
  }
  if (err instanceof TopicNotFoundError) {
    return `no topic '${err.name}', see /list`;
  }
  return 'something went wrong, try again later';
}

export function isKnownDomainError(err: unknown): boolean {
  return (
    err instanceof InvalidTopicNameError ||
    err instanceof DuplicateTopicError ||
    err instanceof TopicNotFoundError
  );
}
