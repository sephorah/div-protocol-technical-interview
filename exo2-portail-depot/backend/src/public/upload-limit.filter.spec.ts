/**
 * What this suite protects: an oversized file is refused by multer BEFORE
 * DepositsService is reached, so this filter is the only place
 * `rejected_size` can ever be counted. Dropped here, the outcome simply never
 * appears in the scrape and the dashboard shows a label that looks unused.
 */

import { ArgumentsHost, PayloadTooLargeException } from '@nestjs/common';
import { MulterError } from 'multer';
import { MetricsService } from '../metrics/metrics.service';
import { UploadLimitFilter } from './upload-limit.filter';
import { FILE_TOO_LARGE } from './upload.constants';

describe('UploadLimitFilter', () => {
  let json: jest.Mock;
  let status: jest.Mock;
  let host: ArgumentsHost;
  let metrics: { recordDeposit: jest.Mock };
  let filter: UploadLimitFilter;

  beforeEach(() => {
    json = jest.fn();
    status = jest.fn().mockReturnValue({ json });
    host = {
      switchToHttp: () => ({ getResponse: () => ({ status }) }),
    } as unknown as ArgumentsHost;
    metrics = { recordDeposit: jest.fn() };
    filter = new UploadLimitFilter(metrics as unknown as MetricsService);
  });

  it('answers 413 in French and counts a size refusal', () => {
    filter.catch(new MulterError('LIMIT_FILE_SIZE'), host);

    expect(status).toHaveBeenCalledWith(413);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: FILE_TOO_LARGE }),
    );
    expect(metrics.recordDeposit).toHaveBeenCalledWith('rejected_size');
  });

  it('counts the same for the exception Nest raises instead', () => {
    // The same event arrives under either name depending on where multer's
    // error is caught; counting only one of the two halves the metric.
    filter.catch(new PayloadTooLargeException(), host);

    expect(metrics.recordDeposit).toHaveBeenCalledWith('rejected_size');
  });

  it('counts a malformed multipart as an error, not as a size refusal', () => {
    filter.catch(new MulterError('LIMIT_UNEXPECTED_FILE'), host);

    expect(status).toHaveBeenCalledWith(400);
    expect(metrics.recordDeposit).toHaveBeenCalledWith('error');
  });
});
