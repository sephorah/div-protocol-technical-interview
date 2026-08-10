import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { MulterError } from 'multer';
import { MetricsService } from '../metrics/metrics.service';
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
  // @UseFilters is given the CLASS, not an instance, which is what lets Nest
  // resolve this through the container. Passing `new UploadLimitFilter()` there
  // would compile and silently leave the counter unincremented.
  constructor(private readonly metrics: MetricsService) {}

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

    // The deposit never reached DepositsService, so this is the only place the
    // attempt can be counted at all.
    this.metrics.recordDeposit(tooLarge ? 'rejected_size' : 'error');

    if (tooLarge) {
      this.observeDeclaredSize(host);
    }

    response.status(status).json({
      message: tooLarge ? FILE_TOO_LARGE : MULTIPART_INVALID,
      error: tooLarge ? 'Payload Too Large' : 'Bad Request',
      statusCode: status,
    });
  }

  /**
   * Multer stops reading at the ceiling, so the real size is unknown here: the
   * only figure available is the one the client declared. It sizes the limit,
   * it decides nothing -- an absent or unparsable header is simply not observed.
   */
  private observeDeclaredSize(host: ArgumentsHost): void {
    const request = host.switchToHttp().getRequest<Request>();
    const declared = Number(request.headers['content-length']);

    if (Number.isFinite(declared) && declared > 0) {
      this.metrics.observeRejectedUploadBytes(declared);
    }
  }
}
