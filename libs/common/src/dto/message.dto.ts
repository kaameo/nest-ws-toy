import { z } from 'zod';

export const MessageQuerySchema = z.object({
  before: z.string().optional(),
  after: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type MessageQueryDto = z.infer<typeof MessageQuerySchema>;

export const UpdateReadCursorSchema = z.object({
  lastReadMessageId: z.string().min(1),
});

export type UpdateReadCursorDto = z.infer<typeof UpdateReadCursorSchema>;

export interface MessageResponse {
  id: string;
  roomId: string;
  senderId: string;
  clientMsgId: string;
  type: string;
  content: string;
  createdAt: Date;
}
