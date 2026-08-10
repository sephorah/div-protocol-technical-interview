import { Readable } from 'node:stream';
import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  generatePin,
  generatePublicToken,
  hashPublicToken,
  hashSecret,
} from '../crypto/secrets';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { ListRequestsDto } from './dto/list-requests.dto';
import { buildDepositUrl } from './public-url';
import { requestNotFound } from './request-ownership';
import {
  CreatedRequestView,
  RequestDetailView,
  RequestPageView,
  toCreatedRequest,
  toRequestDetail,
  toRequestSummary,
} from './request.types';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The last link of a request, and only the two columns a view needs.
 *
 * Ordered on revokedAt with nulls FIRST rather than on createdAt alone: the
 * active link must win even if a regenerated one shares its timestamp --
 * Postgres dates now() from the transaction, and regeneration revokes and
 * inserts inside one.
 */
const LAST_LINK = {
  orderBy: [
    { revokedAt: { sort: 'desc', nulls: 'first' } },
    { createdAt: 'desc' },
  ],
  take: 1,
  select: { expiresAt: true, revokedAt: true },
  // `satisfies` and not `as const`: the latter makes orderBy a readonly tuple,
  // which Prisma's mutable array parameter rejects. Dropping both would widen
  // 'desc' to string, which it rejects too.
} satisfies Prisma.DepositRequest$linksArgs;

/**
 * Same 404 for a piece that carries no file and for one whose file was
 * rejected. The lawyer already knows the request is theirs, so nothing leaks
 * here -- what the single wording buys is that C4 marking a file `failed` does
 * not need a second answer invented for it.
 */
const fileNotAvailable = (): NotFoundException =>
  new NotFoundException("Aucun fichier n'est disponible pour cette pièce.");

/** A deposited file on its way out: the bytes plus what names them. */
export interface DownloadableFile {
  stream: Readable;
  mimeType: string;
  originalName: string;
}

@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly storage: StorageService,
  ) {}

  async create(
    lawyerId: string,
    input: CreateRequestDto,
  ): Promise<CreatedRequestView> {
    const token = generatePublicToken();
    const pin = generatePin();

    // Hashed BEFORE the write: argon2id takes tens of milliseconds, and holding
    // a database transaction open across it would serve no purpose. Same
    // reasoning as src/seed.ts.
    const pinHash = await hashSecret(pin);

    // ONE clock reading for both timestamps. Two would date the expiry from
    // after the hashing, so the validity would not be exactly the one asked
    // for -- and the status derived below would use a third instant again.
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + input.expiresInDays * MILLISECONDS_PER_DAY,
    );

    // A single nested write: Prisma runs it in one implicit transaction, so
    // there can be no request without its link, nor a link without its request.
    // An interactive $transaction would do the same, more verbosely.
    const created = await this.prisma.depositRequest.create({
      data: {
        title: input.title,
        lawyerId,
        items: {
          create: input.items.map((label, position) => ({ label, position })),
        },
        links: {
          create: { tokenHash: hashPublicToken(token), pinHash, expiresAt },
        },
      },
      // Ordered explicitly: the rows share a createdAt to the millisecond, so
      // without this Postgres is free to return them in any order.
      include: { items: { orderBy: { position: 'asc' } } },
    });

    // One of the only two places where the URL and the PIN travel in clear,
    // the other being a regeneration.
    return toCreatedRequest(
      created,
      {
        url: buildDepositUrl(
          this.config.getOrThrow<string>('PUBLIC_BASE_URL'),
          token,
        ),
        pin,
        expiresAt,
      },
      now,
    );
  }

  /**
   * The page and its total go through ONE $transaction: read apart, a creation
   * landing between them makes the dashboard say "3 sur 47" over 46 rows.
   *
   * The pieces are selected rather than counted -- Prisma's _count expresses
   * one filter per relation, and this needs two.
   */
  async list(
    lawyerId: string,
    query: ListRequestsDto,
  ): Promise<RequestPageView> {
    // The ownership filter, in the where clause rather than after the read:
    // there is then no branch in which it can be forgotten.
    const where = { lawyerId };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.depositRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          title: true,
          createdAt: true,
          // `status` and not `id`: since C2 a file can be `failed`, and only a
          // `complete` one counts as received.
          items: { select: { file: { select: { status: true } } } },
          links: LAST_LINK,
        },
      }),
      this.prisma.depositRequest.count({ where }),
    ]);

    // One clock reading for the whole page: twenty requests classified against
    // twenty slightly different instants could disagree at a boundary.
    const now = new Date();

    return {
      items: rows.map((row) => toRequestSummary(row, now)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /**
   * One request with its pieces, received or not.
   *
   * findFirst on BOTH criteria rather than findUnique then a comparison: one
   * query, and no branch in which the ownership check can be forgotten. Same
   * shape as PublicLinksService.ownedRequestId.
   */
  async findOne(
    requestId: string,
    lawyerId: string,
  ): Promise<RequestDetailView> {
    const row = await this.prisma.depositRequest.findFirst({
      where: { id: requestId, lawyerId },
      select: {
        id: true,
        title: true,
        createdAt: true,
        items: {
          // The rows share a createdAt to the millisecond, so without this
          // Postgres is free to reshuffle the checklist between two loads.
          orderBy: { position: 'asc' },
          select: {
            id: true,
            label: true,
            file: {
              select: {
                originalName: true,
                mimeType: true,
                sizeBytes: true,
                status: true,
                createdAt: true,
              },
            },
          },
        },
        links: LAST_LINK,
      },
    });

    if (row === null) {
      throw requestNotFound();
    }
    return toRequestDetail(row, new Date());
  }

  /**
   * Streamed rather than handed over as a pre-signed URL: that would put a
   * SECOND bearer credential in a URL, hence a second entry in the log
   * redaction -- the protection here whose failure is silent. See
   * docs/architecture.md § Le stockage objet.
   *
   * ONE findFirst on the piece, its request and the owner: no branch in which
   * the ownership check can be forgotten. A `failed` file is never served.
   */
  async streamFile(
    requestId: string,
    itemId: string,
    lawyerId: string,
  ): Promise<DownloadableFile> {
    const item = await this.prisma.requestedItem.findFirst({
      where: { id: itemId, requestId, request: { lawyerId } },
      select: {
        file: {
          select: {
            storageKey: true,
            originalName: true,
            mimeType: true,
            status: true,
          },
        },
      },
    });

    if (item === null) {
      throw requestNotFound();
    }
    if (item.file === null || item.file.status !== 'complete') {
      throw fileNotAvailable();
    }

    return {
      stream: await this.storage.getObjectStream(item.file.storageKey),
      mimeType: item.file.mimeType,
      originalName: item.file.originalName,
    };
  }
}
