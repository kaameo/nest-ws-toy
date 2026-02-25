import { z } from 'zod';

export const MessageCreatedEventSchema = z.object({
  eventId: z.uuid(),
  roomId: z.uuid(),
  senderId: z.uuid(),
  clientMsgId: z.uuid(),
  messageType: z.enum(['TEXT', 'IMAGE', 'SYSTEM']).default('TEXT'),
  content: z.string().min(1),
  producedAt: z.string(),
});

export type MessageCreatedEvent = z.infer<typeof MessageCreatedEventSchema>;
