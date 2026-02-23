import { z } from 'zod';

export const MessageCreatedEventSchema = z.object({
  eventId: z.string().uuid(),
  roomId: z.string().uuid(),
  senderId: z.string().uuid(),
  clientMsgId: z.string().uuid(),
  messageType: z.enum(['TEXT', 'IMAGE', 'SYSTEM']).default('TEXT'),
  content: z.string().min(1),
  producedAt: z.string(),
});

export type MessageCreatedEvent = z.infer<typeof MessageCreatedEventSchema>;
