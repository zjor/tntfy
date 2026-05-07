import { InvalidTopicNameError } from './errors';

export const TOPIC_NAME_REGEX = /^[a-z0-9][a-z0-9-_]{1,63}$/;

export function validateTopicName(name: string): void {
  if (!TOPIC_NAME_REGEX.test(name)) {
    throw new InvalidTopicNameError(name);
  }
}
