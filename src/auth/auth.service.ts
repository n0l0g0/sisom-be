import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import * as bcrypt from 'bcrypt';
import { LoginDto } from './dto/login.dto';
import { PrismaService } from '../prisma/prisma.service';
import { User } from '@prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private prisma: PrismaService,
  ) {}

  async validateUser(
    username: string,
    pass: string,
  ): Promise<Omit<User, 'passwordHash'> | null> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    // debug
    // eslint-disable-next-line no-console
    console.log('[auth] validateUser found:', !!user, 'username:', username);

    if (user && (await bcrypt.compare(pass, user.passwordHash))) {
      // eslint-disable-next-line no-console
      console.log('[auth] bcrypt.compare OK for user:', username);
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { passwordHash, ...result } = user;
      return result;
    }
    // eslint-disable-next-line no-console
    console.log('[auth] invalid credentials for:', username);
    return null;
  }

  async login(loginDto: LoginDto) {
    const user = await this.validateUser(loginDto.username, loginDto.password);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = {
      username: user.username,
      sub: user.id,
      role: user.role,
      permissions: user.permissions,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: user,
    };
  }

  async loginWithLine(lineUserId: string) {
    const user = await this.prisma.user.findFirst({
      where: { lineUserId },
    });
    if (!user) {
      throw new UnauthorizedException('LINE account is not linked to any user');
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { passwordHash, ...safeUser } = user;
    const payload = {
      username: safeUser.username,
      sub: safeUser.id,
      role: safeUser.role,
      permissions: safeUser.permissions,
    };
    return {
      access_token: this.jwtService.sign(payload),
      user: safeUser,
    };
  }
}
