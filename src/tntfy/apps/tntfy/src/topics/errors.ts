export class InvalidTopicNameError extends Error {
  constructor(public readonly name: string) {
    super(`invalid topic name: ${name}`);
  }
}

export class DuplicateTopicError extends Error {
  constructor(public readonly name: string) {
    super(`duplicate topic name: ${name}`);
  }
}

export class TopicNotFoundError extends Error {
  constructor(public readonly name: string) {
    super(`topic not found: ${name}`);
  }
}
