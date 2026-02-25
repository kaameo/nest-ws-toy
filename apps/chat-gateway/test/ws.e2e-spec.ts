import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import * as request from 'supertest';
import { io, Socket } from 'socket.io-client';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { KafkaProducerService } from '../src/kafka/kafka-producer.service';
import { randomUUID } from 'crypto';

describe('WebSocket (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let port: number;

  const mockKafkaProducer = {
    publish: jest.fn().mockResolvedValue(undefined),
    onModuleInit: jest.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(KafkaProducerService)
      .useValue(mockKafkaProducer)
      .compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter(),
    );
    dataSource = moduleFixture.get(DataSource);
    await app.init();
    await (app as NestFastifyApplication).getHttpAdapter().getInstance().ready();
    await app.listen(0); // random port
    const url = await app.getUrl();
    port = parseInt(new URL(url).port, 10);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    mockKafkaProducer.publish.mockClear();
    await dataSource.query('TRUNCATE TABLE "messages" CASCADE');
    await dataSource.query('TRUNCATE TABLE "room_members" CASCADE');
    await dataSource.query('TRUNCATE TABLE "rooms" CASCADE');
    await dataSource.query('TRUNCATE TABLE "users" CASCADE');
  });

  // ── Helpers ───────────────────────────────────────────────

  const getToken = async (
    email = 'ws@example.com',
    password = 'password123',
  ): Promise<string> => {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password });
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password });
    return res.body.accessToken;
  };

  const connectSocket = (token: string): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const socket = io(`http://localhost:${port}`, {
        auth: { token },
        transports: ['websocket'],
        forceNew: true,
      });
      socket.on('connect', () => resolve(socket));
      socket.on('connect_error', (err) => reject(err));
      setTimeout(() => reject(new Error('Socket connection timeout')), 5000);
    });

  const disconnectSocket = (socket: Socket): Promise<void> =>
    new Promise((resolve) => {
      if (socket.connected) {
        socket.on('disconnect', () => resolve());
        socket.disconnect();
      } else {
        resolve();
      }
    });

  // ── Tests ─────────────────────────────────────────────────

  it('should connect with valid token', async () => {
    const token = await getToken();
    const socket = await connectSocket(token);
    expect(socket.connected).toBe(true);
    await disconnectSocket(socket);
  });

  it('should disconnect with invalid token', async () => {
    const socket = io(`http://localhost:${port}`, {
      auth: { token: 'invalid-token' },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    });

    const disconnected = await new Promise<boolean>((resolve) => {
      let timer: ReturnType<typeof setTimeout>;
      socket.on('disconnect', () => {
        clearTimeout(timer);
        resolve(true);
      });
      timer = setTimeout(() => {
        socket.disconnect();
        resolve(false);
      }, 3000);
    });

    expect(disconnected).toBe(true);
  });

  it('joinRoom → success when member', async () => {
    const token = await getToken();

    // Create room via HTTP
    const room = await request(app.getHttpServer())
      .post('/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'WS Room' });

    const socket = await connectSocket(token);
    const res = await socket.emitWithAck('joinRoom', {
      roomId: room.body.id,
    });
    expect(res.success).toBe(true);
    await disconnectSocket(socket);
  });

  it('joinRoom → error when not member', async () => {
    const token1 = await getToken('creator@example.com');

    // Create room as user1
    const room = await request(app.getHttpServer())
      .post('/rooms')
      .set('Authorization', `Bearer ${token1}`)
      .send({ name: 'Private Room' });

    // Connect as user2
    const token2 = await getToken('outsider@example.com');
    const socket = await connectSocket(token2);
    const res = await socket.emitWithAck('joinRoom', {
      roomId: room.body.id,
    });
    expect(res.success).toBe(false);
    expect(res.error).toBeDefined();
    await disconnectSocket(socket);
  });

  it('sendMessage → messageAccepted (Kafka mocked)', async () => {
    const token = await getToken();

    // Create & join room
    const room = await request(app.getHttpServer())
      .post('/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Chat Room' });

    const socket = await connectSocket(token);
    await socket.emitWithAck('joinRoom', { roomId: room.body.id });

    const clientMsgId = randomUUID();
    const ack = await socket.emitWithAck('sendMessage', {
      roomId: room.body.id,
      clientMsgId,
      type: 'TEXT',
      content: 'Hello, world!',
    });

    expect(ack.status).toBe('ACCEPTED');
    expect(ack.clientMsgId).toBe(clientMsgId);
    expect(mockKafkaProducer.publish).toHaveBeenCalledTimes(1);
    await disconnectSocket(socket);
  });

  it('heartbeat → success', async () => {
    const token = await getToken();
    const socket = await connectSocket(token);
    const res = await socket.emitWithAck('heartbeat');
    expect(res.success).toBe(true);
    await disconnectSocket(socket);
  });
});
