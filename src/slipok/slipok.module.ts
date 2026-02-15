 import { Module } from '@nestjs/common';
 import { SlipOkService } from './slipok.service';
 
 @Module({
   providers: [SlipOkService],
   exports: [SlipOkService],
 })
 export class SlipOkModule {}
