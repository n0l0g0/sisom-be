import { IsString, IsOptional, IsArray, IsEnum } from 'class-validator';
import type { Role } from '@prisma/client';

const RoleEnum = {
  OWNER: 'OWNER',
  ADMIN: 'ADMIN',
  STAFF: 'STAFF',
  USER: 'USER',
} as const;

export class CreateUserDto {
  @IsString()
  username: string;

  @IsString()
  passwordHash: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEnum(RoleEnum)
  @IsOptional()
  role?: Role;

  @IsArray()
  @IsOptional()
  permissions?: string[];

  @IsString()
  @IsOptional()
  lineUserId?: string;

  @IsString()
  @IsOptional()
  verifyCode?: string;
}
