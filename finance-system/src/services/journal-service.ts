import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { JournalEntry, JournalEntryWithLines, LineItem } from '../models/types';
import { CreateJournalEntryInput } from '../models/validation';

export class JournalService {
  constructor(private db: Database.Database) {}

  create(input: CreateJournalEntryInput): JournalEntryWithLines {
    const totalDebits = input.lines.reduce((sum, l) => sum + l.debit, 0);
    const totalCredits = input.lines.reduce((sum, l) => sum + l.credit, 0);

    if (Math.abs(totalDebits - totalCredits) > 0.001) {
      throw new Error(`Entry is not balanced: debits=${totalDebits}, credits=${totalCredits}`);
    }

    if (totalDebits === 0) {
      throw new Error('Entry must have at least one debit and one credit');
    }

    // Verify all accounts exist
    const accountCheck = this.db.prepare('SELECT id FROM accounts WHERE id = ?');
    for (const line of input.lines) {
      if (!accountCheck.get(line.account_id)) {
        throw new Error(`Account not found: ${line.account_id}`);
      }
    }

    const entryId = uuidv4();

    const insertEntry = this.db.prepare(`
      INSERT INTO journal_entries (id, date, description, reference)
      VALUES (?, ?, ?, ?)
    `);

    const insertLine = this.db.prepare(`
      INSERT INTO line_items (id, journal_entry_id, account_id, debit, credit, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction(() => {
      insertEntry.run(entryId, input.date, input.description, input.reference || null);
      for (const line of input.lines) {
        insertLine.run(uuidv4(), entryId, line.account_id, line.debit, line.credit, line.description || null);
      }
    });

    transaction();
    return this.getById(entryId)!;
  }

  getById(id: string): JournalEntryWithLines | undefined {
    const entry = this.db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id) as JournalEntry | undefined;
    if (!entry) return undefined;

    const lines = this.db.prepare('SELECT * FROM line_items WHERE journal_entry_id = ?').all(id) as LineItem[];
    return { ...entry, lines };
  }

  list(options?: { startDate?: string; endDate?: string; posted?: boolean }): JournalEntryWithLines[] {
    let query = 'SELECT * FROM journal_entries WHERE 1=1';
    const params: any[] = [];

    if (options?.startDate) { query += ' AND date >= ?'; params.push(options.startDate); }
    if (options?.endDate) { query += ' AND date <= ?'; params.push(options.endDate); }
    if (options?.posted !== undefined) { query += ' AND is_posted = ?'; params.push(options.posted ? 1 : 0); }

    query += ' ORDER BY date DESC, created_at DESC';

    const entries = this.db.prepare(query).all(...params) as JournalEntry[];
    return entries.map(entry => {
      const lines = this.db.prepare('SELECT * FROM line_items WHERE journal_entry_id = ?').all(entry.id) as LineItem[];
      return { ...entry, lines };
    });
  }

  post(id: string): JournalEntryWithLines | undefined {
    const entry = this.getById(id);
    if (!entry) return undefined;
    if (entry.is_posted) throw new Error('Entry is already posted');

    this.db.prepare("UPDATE journal_entries SET is_posted = 1, updated_at = datetime('now') WHERE id = ?").run(id);
    return this.getById(id);
  }

  void(id: string): JournalEntryWithLines {
    const entry = this.getById(id);
    if (!entry) throw new Error('Journal entry not found');

    // Create a reversing entry
    const reversingLines = entry.lines.map(line => ({
      account_id: line.account_id,
      debit: line.credit,
      credit: line.debit,
      description: `Void: ${line.description || ''}`,
    }));

    return this.create({
      date: new Date().toISOString().split('T')[0],
      description: `Void of entry ${id}: ${entry.description}`,
      reference: `VOID-${entry.reference || id}`,
      lines: reversingLines,
    });
  }

  delete(id: string): boolean {
    const entry = this.getById(id);
    if (!entry) return false;
    if (entry.is_posted) throw new Error('Cannot delete a posted entry. Void it instead.');

    const result = this.db.prepare('DELETE FROM journal_entries WHERE id = ?').run(id);
    return result.changes > 0;
  }
}
