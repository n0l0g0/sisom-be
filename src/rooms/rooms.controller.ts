import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';

@Controller('rooms')
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  create(@Body() createRoomDto: CreateRoomDto) {
    return this.roomsService.create(createRoomDto);
  }

  @Get()
  findAll() {
    return this.roomsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.roomsService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateRoomDto: UpdateRoomDto) {
    return this.roomsService.update(id, updateRoomDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.roomsService.remove(id);
  }

  @Get(':id/contacts')
  async getContacts(@Param('id') id: string) {
    const contacts = await this.roomsService.getRoomContacts(id);
    return { contacts };
  }

  @Post(':id/contacts')
  async addContact(
    @Param('id') id: string,
    @Body() body: { name?: string; phone?: string },
  ) {
    const contacts = await this.roomsService.addRoomContact(id, body);
    return { contacts };
  }

  @Post(':id/contacts/:contactId/clear-line')
  clearContactLine(
    @Param('id') id: string,
    @Param('contactId') contactId: string,
  ) {
    const contacts = this.roomsService.clearRoomContactLine(id, contactId);
    return { contacts };
  }

  @Delete(':id/contacts/:contactId')
  deleteContact(
    @Param('id') id: string,
    @Param('contactId') contactId: string,
  ) {
    const contacts = this.roomsService.deleteRoomContact(id, contactId);
    return { contacts };
  }

  @Get(':id/payment-schedule')
  getPaymentSchedule(@Param('id') id: string) {
    const schedule = this.roomsService.getRoomPaymentSchedule(id);
    return { schedule };
  }

  @Post(':id/payment-schedule')
  async setPaymentSchedule(
    @Param('id') id: string,
    @Body() body: { date?: string; monthly?: boolean },
  ) {
    const schedule = await this.roomsService.setRoomPaymentSchedule(id, body);
    return { schedule };
  }

  @Get('payment-schedules')
  listPaymentSchedules() {
    const schedules = this.roomsService.listRoomPaymentSchedules();
    return { schedules };
  }
}
