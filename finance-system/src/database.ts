import Database from 'better-sqlite3';
import path from 'path';

let db: Database.Database;

export function getDatabase(dbPath?: string): Database.Database {
  if (!db) {
    const resolvedPath = dbPath || path.join(process.cwd(), 'finance.db');
    db = new Database(resolvedPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

export function createTestDatabase(): Database.Database {
  const testDb = new Database(':memory:');
  testDb.pragma('foreign_keys = ON');
  return testDb;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = undefined as any;
  }
}
