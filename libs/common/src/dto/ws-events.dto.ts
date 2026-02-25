import { z } from 'zod';

export const SendMessageSchema = z.object({
  roomId: z.uuid(),
  clientMsgId: z.uuid(),
  type: z.enum(['TEXT', 'IMAGE']).default('TEXT'),
  content: z.string().min(1).max(5000),
});

export type SendMessageDto = z.infer<typeof SendMessageSchema>;

export interface MessageAck {
  clientMsgId: string;
  status: 'ACCEPTED' | 'FAILED';
  error?: string;
}
