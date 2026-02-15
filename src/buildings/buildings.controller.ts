import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { BuildingsService } from './buildings.service';
import { CreateBuildingDto } from './dto/create-building.dto';

@Controller('buildings')
export class BuildingsController {
  constructor(private readonly buildings: BuildingsService) {}

  @Post()
  create(@Body() dto: CreateBuildingDto) {
    return this.buildings.create(dto);
  }

  @Get()
  findAll() {
    return this.buildings.findAll();
  }

  @Post(':id/generate-rooms')
  generateRooms(
    @Param('id') id: string,
    @Body()
    body: {
      floors: Array<{
        floor: number;
        rooms: number;
        pricePerMonth?: number;
      }>;
      format?: {
        digits?: 3 | 4;
        buildingDigit?: string;
        prefix?: string;
      };
    },
  ) {
    return this.buildings.generateRooms(id, body);
  }
}
