import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { Account } from '../models/types';
import { CreateAccountInput, UpdateAccountInput } from '../models/validation';

export class AccountService {
  constructor(private db: Database.Database) {}

  create(input: CreateAccountInput): Account {
    const id = uuidv4();
    const stmt = this.db.prepare(`
      INSERT INTO accounts (id, code, name, type, parent_id, description)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, input.code, input.name, input.type, input.parent_id || null, input.description || null);
    return this.getById(id)!;
  }

  getById(id: string): Account | undefined {
    return this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Account | undefined;
  }

  getByCode(code: string): Account | undefined {
    return this.db.prepare('SELECT * FROM accounts WHERE code = ?').get(code) as Account | undefined;
  }

  list(type?: string): Account[] {
    if (type) {
      return this.db.prepare('SELECT * FROM accounts WHERE type = ? ORDER BY code').all(type) as Account[];
    }
    return this.db.prepare('SELECT * FROM accounts ORDER BY code').all() as Account[];
  }

  update(id: string, input: UpdateAccountInput): Account | undefined {
    const account = this.getById(id);
    if (!account) return undefined;

    const fields: string[] = [];
    const values: any[] = [];

    if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
    if (input.description !== undefined) { fields.push('description = ?'); values.push(input.description); }
    if (input.is_active !== undefined) { fields.push('is_active = ?'); values.push(input.is_active); }

    if (fields.length === 0) return account;

    fields.push("updated_at = datetime('now')");
    values.push(id);

    this.db.prepare(`UPDATE accounts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return this.getById(id);
  }

  delete(id: string): boolean {
    const hasLines = this.db.prepare('SELECT COUNT(*) as count FROM line_items WHERE account_id = ?').get(id) as any;
    if (hasLines.count > 0) {
      throw new Error('Cannot delete account with existing transactions');
    }
    const result = this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
    return result.changes > 0;
  }

  getChildren(parentId: string): Account[] {
    return this.db.prepare('SELECT * FROM accounts WHERE parent_id = ? ORDER BY code').all(parentId) as Account[];
  }
}
