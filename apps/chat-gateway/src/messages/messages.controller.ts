import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  UseGuards,
  Request,
  UsePipes,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { MessagesService } from './messages.service';
import {
  MessageQuerySchema,
  MessageQueryDto,
  UpdateReadCursorSchema,
  UpdateReadCursorDto,
  ZodValidationPipe,
} from '@app/common';

@Controller('rooms/:roomId')
@UseGuards(AuthGuard('jwt'))
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get('messages')
  async getMessages(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Query(new ZodValidationPipe(MessageQuerySchema)) query: MessageQueryDto,
    @Request() req: any,
  ) {
    return this.messagesService.getMessages(roomId, req.user.userId, query);
  }

  @Post('read')
  async updateReadCursor(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Body(new ZodValidationPipe(UpdateReadCursorSchema)) dto: UpdateReadCursorDto,
    @Request() req: any,
  ) {
    await this.messagesService.updateReadCursor(roomId, req.user.userId, dto.lastReadMessageId);
    return { success: true };
  }
}
