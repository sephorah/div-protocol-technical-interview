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
  let headers: Record<string, string>;
  let host: ArgumentsHost;
  let metrics: {
    recordDeposit: jest.Mock;
    observeRejectedUploadBytes: jest.Mock;
  };
  let filter: UploadLimitFilter;

  beforeEach(() => {
    json = jest.fn();
    status = jest.fn().mockReturnValue({ json });
    headers = {};
    host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ headers }),
      }),
    } as unknown as ArgumentsHost;
    metrics = {
      recordDeposit: jest.fn(),
      observeRejectedUploadBytes: jest.fn(),
    };
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
    expect(metrics.observeRejectedUploadBytes).not.toHaveBeenCalled();
  });

  it('observes the size the client declared when it refuses an oversized file', () => {
    headers['content-length'] = '41943040';

    filter.catch(new MulterError('LIMIT_FILE_SIZE'), host);

    expect(metrics.observeRejectedUploadBytes).toHaveBeenCalledWith(41_943_040);
  });

  it('observes nothing when the client declared no length', () => {
    filter.catch(new MulterError('LIMIT_FILE_SIZE'), host);

    expect(metrics.observeRejectedUploadBytes).not.toHaveBeenCalled();
  });

  // A chunked or forged header must not turn into a NaN observation, which
  // prom-client accepts and which poisons every quantile drawn from it.
  it('observes nothing when the declared length is not a number', () => {
    headers['content-length'] = 'quarante';

    filter.catch(new MulterError('LIMIT_FILE_SIZE'), host);

    expect(metrics.observeRejectedUploadBytes).not.toHaveBeenCalled();
  });
});
