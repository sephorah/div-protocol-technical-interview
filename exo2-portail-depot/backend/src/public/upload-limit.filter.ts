import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Response } from 'express';
import { MulterError } from 'multer';
import { FILE_TOO_LARGE } from './upload.constants';

const MULTIPART_INVALID = 'Envoi multipart invalide.';

/**
 * Turns a size overrun into the 413 the contract announces.
 *
 * Two exception types, because the same event can arrive under either name.
 * @nestjs/platform-express already maps multer's LIMIT_FILE_SIZE to a
 * PayloadTooLargeException -- but it matches on the ENGLISH message multer
 * raises, and it carries that message through to the client. A caller would
 * read "File too large" in the middle of French answers, and the mapping itself
 * would break silently the day multer rewords it. Catching MulterError as well
 * is the belt behind that brace.
 *
 * Without this filter the raw MulterError is an unclassified error, i.e. a 500
 * on a perfectly ordinary case: a client picking a file that is too big.
 */
@Catch(PayloadTooLargeException, MulterError)
export class UploadLimitFilter implements ExceptionFilter {
  catch(
    exception: PayloadTooLargeException | MulterError,
    host: ArgumentsHost,
  ) {
    const response = host.switchToHttp().getResponse<Response>();

    const tooLarge =
      exception instanceof PayloadTooLargeException ||
      exception.code === 'LIMIT_FILE_SIZE';

    // The other multer codes (too many parts, unexpected field) are a malformed
    // request, not an oversized one.
    const status = tooLarge
      ? HttpStatus.PAYLOAD_TOO_LARGE
      : HttpStatus.BAD_REQUEST;

    response.status(status).json({
      message: tooLarge ? FILE_TOO_LARGE : MULTIPART_INVALID,
      error: tooLarge ? 'Payload Too Large' : 'Bad Request',
      statusCode: status,
    });
  }
}
