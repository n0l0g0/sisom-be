import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { MediaService } from './media.service';
import type { Request } from 'express';
import type { Response } from 'express';

type UploadFile = {
  originalname: string;
  mimetype: string;
  filename: string;
};

type DestinationCallback = (error: Error | null, destination: string) => void;
type FilenameCallback = (error: Error | null, filename: string) => void;
type FileFilterCallback = (error: Error | null, acceptFile: boolean) => void;
type DiskStorageFactory = (options: {
  destination: (
    req: Request,
    file: UploadFile,
    cb: DestinationCallback,
  ) => void;
  filename: (req: Request, file: UploadFile, cb: FilenameCallback) => void;
}) => unknown;

const createDiskStorage = diskStorage as unknown as DiskStorageFactory;

const uploadDir = join(process.cwd(), 'uploads');
if (!existsSync(uploadDir)) {
  mkdirSync(uploadDir, { recursive: true });
}

@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: createDiskStorage({
        destination: (
          _req: Request,
          _file: UploadFile,
          cb: DestinationCallback,
        ) => {
          cb(null, uploadDir);
        },
        filename: (_req: Request, file: UploadFile, cb: FilenameCallback) => {
          const unique =
            Date.now().toString() + '-' + Math.random().toString(36).slice(2);
          cb(null, `${unique}${extname(file.originalname)}`);
        },
      }),
      fileFilter: (_req: Request, file: UploadFile, cb: FileFilterCallback) => {
        if (!file.mimetype.startsWith('image/')) {
          return cb(
            new BadRequestException('รองรับเฉพาะไฟล์รูปภาพเท่านั้น'),
            false,
          );
        }
        return cb(null, true);
      },
      limits: {
        fileSize: 5 * 1024 * 1024,
      },
    }),
  )
  upload(@UploadedFile() file: UploadFile | undefined, @Req() req: Request) {
    if (!file) {
      throw new BadRequestException('ไม่พบไฟล์ที่อัปโหลด');
    }
    return {
      url: this.mediaService.buildUrl(req, file.filename),
      filename: file.filename,
    };
  }

  @Get(':filename')
  serve(@Param('filename') filename: string, @Res() res: Response) {
    const filePath = join(this.mediaService.getUploadDir(), filename);
    res.sendFile(filePath, (err) => {
      if (err) {
        res
          .status(404)
          .json({ message: 'Not Found', error: 'Not Found', statusCode: 404 });
      }
    });
  }

  @Get('room/:filename')
  serveRoom(@Param('filename') filename: string, @Res() res: Response) {
    const filePath = join(this.mediaService.getRoomDir(), filename);
    res.sendFile(filePath, (err) => {
      if (err) {
        res
          .status(404)
          .json({ message: 'Not Found', error: 'Not Found', statusCode: 404 });
      }
    });
  }
}
