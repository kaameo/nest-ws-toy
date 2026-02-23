import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  Request,
  UsePipes,
  ParseUUIDPipe,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { RoomsService } from './rooms.service';
import { CreateRoomSchema, CreateRoomDto, ZodValidationPipe } from '@app/common';

@Controller('rooms')
@UseGuards(AuthGuard('jwt'))
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  @UsePipes(new ZodValidationPipe(CreateRoomSchema))
  async create(@Body() dto: CreateRoomDto, @Request() req: any) {
    return this.roomsService.create(dto, req.user.userId);
  }

  @Post(':roomId/join')
  async join(
    @Param('roomId', ParseUUIDPipe) roomId: string,
    @Request() req: any,
  ) {
    return this.roomsService.join(roomId, req.user.userId);
  }

  @Get()
  async findMyRooms(@Request() req: any) {
    return this.roomsService.findMyRooms(req.user.userId);
  }

  @Get(':roomId/members')
  async findMembers(@Param('roomId', ParseUUIDPipe) roomId: string) {
    return this.roomsService.findMembers(roomId);
  }
}
