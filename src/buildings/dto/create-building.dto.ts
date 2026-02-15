import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateBuildingDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsInt()
  @Min(1)
  floors: number;
}
