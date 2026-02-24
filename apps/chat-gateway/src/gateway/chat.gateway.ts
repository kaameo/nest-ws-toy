import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { JwtPayload } from '../auth/jwt.strategy';
import { PresenceService } from '../presence/presence.service';
import { RoomsService } from '../rooms/rooms.service';
import { KafkaProducerService } from '../kafka/kafka-producer.service';
import {
  SendMessageSchema,
  SendMessageDto,
  MessageAck,
  MessageCreatedEvent,
  KAFKA_TOPICS,
} from '@app/common';

interface AuthenticatedSocket extends Socket {
  user: { userId: string; email: string };
}

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: '/',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private readonly serverId: string;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly presenceService: PresenceService,
    private readonly roomsService: RoomsService,
    private readonly kafkaProducer: KafkaProducerService,
  ) {
    this.serverId = `gateway-${process.pid}`;
  }

  async handleConnection(client: AuthenticatedSocket): Promise<void> {
    try {
      const token =
        client.handshake.auth?.token ??
        client.handshake.headers.authorization?.replace('Bearer ', '');

      if (!token) {
        this.logger.warn('Connection rejected: no token');
        client.disconnect();
        return;
      }

      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      });

      client.user = { userId: payload.sub, email: payload.email };
      await this.presenceService.setOnline(payload.sub, this.serverId, client.id);
      this.logger.log(`Client connected: ${client.id} (user: ${payload.sub})`);
    } catch {
      this.logger.warn(`Connection rejected: invalid token (${client.id})`);
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedSocket): Promise<void> {
    if (client.user) {
      await this.presenceService.setOffline(client.user.userId, client.id);
      this.logger.log(`Client disconnected: ${client.id} (user: ${client.user.userId})`);
    }
  }

  @SubscribeMessage('joinRoom')
  async handleJoinRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string },
  ): Promise<{ success: boolean; error?: string }> {
    if (!client.user) {
      return { success: false, error: 'Not authenticated' };
    }
    const { roomId } = data;
    const userId = client.user.userId;

    const isMember = await this.roomsService.isMember(roomId, userId);
    if (!isMember) {
      return { success: false, error: 'Not a member of this room' };
    }

    await client.join(roomId);
    this.logger.log(`User ${userId} joined room ${roomId}`);
    return { success: true };
  }

  @SubscribeMessage('sendMessage')
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: unknown,
  ): Promise<MessageAck> {
    if (!client.user) {
      return { clientMsgId: '', status: 'FAILED', error: 'Not authenticated' };
    }

    const parsed = SendMessageSchema.safeParse(data);
    if (!parsed.success) {
      return { clientMsgId: '', status: 'FAILED', error: 'Invalid message format' };
    }

    const dto: SendMessageDto = parsed.data;
    const userId = client.user.userId;

    const isMember = await this.roomsService.isMember(dto.roomId, userId);
    if (!isMember) {
      return { clientMsgId: dto.clientMsgId, status: 'FAILED', error: 'Not a member of this room' };
    }

    const event: MessageCreatedEvent = {
      eventId: randomUUID(),
      roomId: dto.roomId,
      senderId: userId,
      clientMsgId: dto.clientMsgId,
      messageType: dto.type,
      content: dto.content,
      producedAt: new Date().toISOString(),
    };

    try {
      await this.kafkaProducer.publish(
        KAFKA_TOPICS.MESSAGES_V1,
        dto.roomId,
        event as unknown as Record<string, unknown>,
      );
      return { clientMsgId: dto.clientMsgId, status: 'ACCEPTED' };
    } catch (error) {
      this.logger.error(`Failed to publish message: ${error}`);
      return { clientMsgId: dto.clientMsgId, status: 'FAILED', error: 'Message delivery failed' };
    }
  }

  @SubscribeMessage('heartbeat')
  async handleHeartbeat(
    @ConnectedSocket() client: AuthenticatedSocket,
  ): Promise<{ success: boolean }> {
    if (client.user) {
      await this.presenceService.refreshTTL(client.user.userId, client.id);
    }
    return { success: true };
  }
}
