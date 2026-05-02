import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { BasicStrategy } from 'passport-http';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class BasicAuthStrategy extends PassportStrategy(BasicStrategy) {
  constructor(private configService: ConfigService) {
    super();
  }

  async validate(username: string, password: string): Promise<any> {
    const validUsername = this.configService.get<string>('auth.username');
    const validPassword = this.configService.get<string>('auth.password');

    if (username === validUsername && password === validPassword) {
      return { username };
    }

    throw new UnauthorizedException('Invalid credentials');
  }
}
