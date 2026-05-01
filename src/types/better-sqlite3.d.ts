declare module "better-sqlite3" {
  class Database {
    constructor(path: string, options?: { readonly?: boolean; fileMustExist?: boolean });
    prepare(sql: string): Statement;
    exec(sql: string): void;
    pragma(source: string, options?: { simple?: boolean }): unknown;
    transaction(fn: () => void): () => void;
    close(): void;
  }
  class Statement {
    run(...params: unknown[]): { changes: number; lastInsertRowid: number };
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }
  export default Database;
}
