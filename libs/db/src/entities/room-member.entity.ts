import {
  Entity,
  Column,
  PrimaryColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('room_members')
export class RoomMember {
  @PrimaryColumn({ name: 'room_id', type: 'uuid' })
  roomId: string;

  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @CreateDateColumn({ name: 'joined_at' })
  joinedAt: Date;

  @Column({ name: 'last_read_message_id', nullable: true })
  lastReadMessageId: string | null;
}
