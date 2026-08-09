import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import {
  DEFAULT_PAGE_SIZE,
  ListRequestsDto,
  MAX_PAGE_SIZE,
} from './list-requests.dto';

const check = (query: Record<string, unknown>) => {
  const dto = plainToInstance(ListRequestsDto, query);
  return { dto, errors: validateSync(dto) };
};

describe('ListRequestsDto', () => {
  it('defaults to the first page', () => {
    const { dto, errors } = check({});

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(1);
    expect(dto.pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  // Query parameters always arrive as strings. Without the coercion, @IsInt
  // rejects "2" and every paginated call answers 400.
  it('accepts the strings a query string actually carries', () => {
    const { dto, errors } = check({ page: '3', pageSize: '50' });

    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(3);
    expect(dto.pageSize).toBe(50);
  });

  it('refuses a page below one', () => {
    expect(check({ page: '0' }).errors).toHaveLength(1);
  });

  it('refuses something that is not a number', () => {
    expect(check({ page: 'deux' }).errors).toHaveLength(1);
  });

  // Unbounded, one authenticated call pulls the whole table and its pieces.
  it('refuses a page size above the ceiling', () => {
    expect(check({ pageSize: String(MAX_PAGE_SIZE + 1) }).errors).toHaveLength(
      1,
    );
  });

  it('accepts the ceiling itself', () => {
    expect(check({ pageSize: String(MAX_PAGE_SIZE) }).errors).toHaveLength(0);
  });

  it('speaks French, never the library default', () => {
    const messages = check({
      page: '0',
      pageSize: String(MAX_PAGE_SIZE + 1),
    }).errors.flatMap((error) => Object.values(error.constraints ?? {}));

    expect(messages).not.toHaveLength(0);
    for (const message of messages) {
      expect(message).not.toContain('must be');
    }
  });
});
