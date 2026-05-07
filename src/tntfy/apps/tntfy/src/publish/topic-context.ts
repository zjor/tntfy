export interface TopicContext {
  topic_id: string;
  topic_name: string;
  user_id: string;
  chat_id: number;
}

declare module 'express' {
  interface Request {
    topicContext?: TopicContext;
  }
}
