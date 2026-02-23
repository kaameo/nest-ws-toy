import { z } from 'zod';

export const CreateRoomSchema = z.object({
  name: z.string().min(1).max(100),
});

export type CreateRoomDto = z.infer<typeof CreateRoomSchema>;
