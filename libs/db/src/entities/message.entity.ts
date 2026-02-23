import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  Index,
  Unique,
} from 'typeorm';

@Entity('messages')
@Unique('UQ_messages_dedup', ['roomId', 'senderId', 'clientMsgId'])
@Index('IDX_messages_room_id', ['roomId', 'id'])
export class Message {
  @PrimaryColumn({ type: 'varchar', length: 26 })
  id: string; // ULID

  @Column({ name: 'room_id', type: 'uuid' })
  roomId: string;

  @Column({ name: 'sender_id', type: 'uuid' })
  senderId: string;

  @Column({ name: 'client_msg_id', type: 'uuid' })
  clientMsgId: string;

  @Column({ type: 'varchar', length: 20, default: 'TEXT' })
  type: string; // TEXT | IMAGE | SYSTEM

  @Column({ type: 'text' })
  content: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
