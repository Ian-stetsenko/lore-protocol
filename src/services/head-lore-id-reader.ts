import type { IGitClient } from '../interfaces/git-client.js';
import type { TrailerParser } from './trailer-parser.js';
import type { LoreId } from '../types/domain.js';
import { LORE_ID_PATTERN } from '../util/constants.js';

/**
 * Reads the Lore-id from the HEAD commit message.
 *
 * Used during --amend to preserve the existing Lore-id so that
 * knowledge-graph references (Related, Supersedes, Depends-on) remain valid.
 *
 * GRASP: Information Expert -- knows how to extract a Lore-id from HEAD.
 * SRP: Only reads the Lore-id from HEAD; no other responsibilities.
 */
export class HeadLoreIdReader {
  constructor(
    private readonly gitClient: IGitClient,
    private readonly trailerParser: TrailerParser,
  ) {}

  async read(): Promise<LoreId | null> {
    let message: string;
    try {
      message = await this.gitClient.getHeadMessage();
    } catch {
      return null;
    }

    const trailerBlock = this.trailerParser.extractTrailerBlock(message);
    if (!trailerBlock) return null;

    const trailers = this.trailerParser.parse(trailerBlock, []);
    const loreId = trailers['Lore-id'];
    return loreId && LORE_ID_PATTERN.test(loreId) ? loreId : null;
  }
}
