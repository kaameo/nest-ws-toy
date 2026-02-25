import { z } from 'zod';

export const MessagePersistedEventSchema = z.object({
  messageId: z.string(),
  roomId: z.uuid(),
  senderId: z.uuid(),
  clientMsgId: z.uuid(),
  messageType: z.string(),
  content: z.string(),
  createdAt: z.string(),
});

export type MessagePersistedEvent = z.infer<typeof MessagePersistedEventSchema>;
