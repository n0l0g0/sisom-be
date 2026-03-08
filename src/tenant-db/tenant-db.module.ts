import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { TenantDbService } from './tenant-db.service';
import { TenantDbMiddleware } from './tenant-db.middleware';

@Module({
  providers: [TenantDbService],
  exports: [TenantDbService],
})
export class TenantDbModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantDbMiddleware).forRoutes('*');
  }
}