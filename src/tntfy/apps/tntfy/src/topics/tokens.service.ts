import { Inject, Injectable } from '@nestjs/common';
import { Kysely } from 'kysely';
import { customAlphabet } from 'nanoid';
import { KYSELY } from '../database/database.module';
import type { Database } from '../database/schema';
import { AuditLogger } from '../logging/audit.service';

export const TOKEN_REGEX = /^tk_[A-Za-z0-9_-]{24}$/;
const TOKEN_BODY = customAlphabet(
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
  24,
);

@Injectable()
export class TokensService {
  constructor(
    @Inject(KYSELY) private readonly db: Kysely<Database>,
    private readonly audit: AuditLogger,
  ) {}

  generate(): string {
    return `tk_${TOKEN_BODY()}`;
  }
}
