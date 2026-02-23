import { z } from 'zod';

export const MessagePersistedEventSchema = z.object({
  messageId: z.string(),
  roomId: z.string().uuid(),
  senderId: z.string().uuid(),
  clientMsgId: z.string().uuid(),
  messageType: z.string(),
  content: z.string(),
  createdAt: z.string(),
});

export type MessagePersistedEvent = z.infer<typeof MessagePersistedEventSchema>;
