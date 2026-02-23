import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { KafkaProducerService } from '../src/kafka/kafka-producer.service';

describe('ChatGateway (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

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

    app = moduleFixture.createNestApplication();
    dataSource = moduleFixture.get(DataSource);
    await app.init();
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

  const registerUser = (
    email = 'test@example.com',
    password = 'password123',
  ) =>
    request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password });

  const loginUser = (email = 'test@example.com', password = 'password123') =>
    request(app.getHttpServer()).post('/auth/login').send({ email, password });

  const getToken = async (
    email = 'test@example.com',
    password = 'password123',
  ): Promise<string> => {
    await registerUser(email, password);
    const res = await loginUser(email, password);
    return res.body.accessToken;
  };

  // ── Health ────────────────────────────────────────────────

  describe('GET /health', () => {
    it('should return 200', () =>
      request(app.getHttpServer()).get('/health').expect(200));
  });

  // ── Auth ──────────────────────────────────────────────────

  describe('Auth', () => {
    it('POST /auth/register → 201', async () => {
      const res = await registerUser();
      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.email).toBe('test@example.com');
    });

    it('POST /auth/register → 409 duplicate email', async () => {
      await registerUser();
      const res = await registerUser();
      expect(res.status).toBe(409);
    });

    it('POST /auth/login → 200 with JWT', async () => {
      await registerUser();
      const res = await loginUser();
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('accessToken');
    });

    it('POST /auth/login → 401 wrong password', async () => {
      await registerUser();
      const res = await loginUser('test@example.com', 'wrongpassword');
      expect(res.status).toBe(401);
    });
  });

  // ── Rooms ─────────────────────────────────────────────────

  describe('Rooms', () => {
    let token: string;

    beforeEach(async () => {
      token = await getToken();
    });

    it('POST /rooms → 201 create room', async () => {
      const res = await request(app.getHttpServer())
        .post('/rooms')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Test Room' });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.name).toBe('Test Room');
    });

    it('POST /rooms/:roomId/join → 200', async () => {
      // Create room (creator auto-joins)
      const room = await request(app.getHttpServer())
        .post('/rooms')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Join Room' });

      // Second user joins
      const token2 = await getToken('user2@example.com', 'password123');
      const res = await request(app.getHttpServer())
        .post(`/rooms/${room.body.id}/join`)
        .set('Authorization', `Bearer ${token2}`);

      expect(res.status).toBe(201);
    });

    it('GET /rooms → my rooms list', async () => {
      await request(app.getHttpServer())
        .post('/rooms')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'My Room' });

      const res = await request(app.getHttpServer())
        .get('/rooms')
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
      expect(res.body.length).toBe(1);
      expect(res.body[0].name).toBe('My Room');
    });

    it('GET /rooms/:roomId/members → member list', async () => {
      const room = await request(app.getHttpServer())
        .post('/rooms')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Members Room' });

      const res = await request(app.getHttpServer())
        .get(`/rooms/${room.body.id}/members`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
      expect(res.body.length).toBe(1);
    });
  });

  // ── Messages ──────────────────────────────────────────────

  describe('Messages', () => {
    let token: string;
    let roomId: string;

    beforeEach(async () => {
      token = await getToken();
      const room = await request(app.getHttpServer())
        .post('/rooms')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Msg Room' });
      roomId = room.body.id;
    });

    it('GET /rooms/:roomId/messages → empty array', async () => {
      const res = await request(app.getHttpServer())
        .get(`/rooms/${roomId}/messages`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toBeInstanceOf(Array);
      expect(res.body.length).toBe(0);
    });

    it('POST /rooms/:roomId/read → update read cursor', async () => {
      const res = await request(app.getHttpServer())
        .post(`/rooms/${roomId}/read`)
        .set('Authorization', `Bearer ${token}`)
        .send({ lastReadMessageId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });

      expect(res.status).toBe(201);
      expect(res.body).toEqual({ success: true });
    });
  });

  // ── Auth guard ────────────────────────────────────────────

  describe('Auth guard', () => {
    it('GET /rooms without token → 401', () =>
      request(app.getHttpServer()).get('/rooms').expect(401));

    it('GET /rooms with invalid token → 401', () =>
      request(app.getHttpServer())
        .get('/rooms')
        .set('Authorization', 'Bearer invalid-token')
        .expect(401));
  });
});
