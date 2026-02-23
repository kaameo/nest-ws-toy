export const KAFKA_TOPICS = {
  MESSAGES_V1: 'chat.messages.v1',
  MESSAGES_PERSISTED_V1: 'chat.messages.persisted.v1',
} as const;

export const KAFKA_CONSUMER_GROUPS = {
  PERSISTOR: 'chat-persistor',
  BROADCAST: 'chat-broadcast',
} as const;

export const KAFKA_CLIENT_ID = 'chat-service';
