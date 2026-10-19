import 'dotenv/config';
import fs from 'fs';
import path from 'path';

// 统一数据访问层：屏蔽底层引擎差异，业务代码只调用 all/get/run/exec。
//  - 开发期：Node 24 内置 node:sqlite（零原生依赖、无需编译）
//  - 信创期：Knex(pg / mysql2)（人大金仓/达梦兼容协议）。切换时只需补全此分支，业务代码零改动。
const client = (process.env.DB_CLIENT || 'sqlite3').toLowerCase();

async function buildDb() {
  if (client === 'sqlite3' || client === 'sqlite') {
    const { DatabaseSync } = await import('node:sqlite');
    const file = process.env.DB_FILENAME || './data/credit_analysis.sqlite';
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const native = new DatabaseSync(file);
    native.exec('PRAGMA journal_mode = WAL;');
    return {
      engine: 'node:sqlite',
      all: (sql, params = []) => native.prepare(sql).all(...params),
      get: (sql, params = []) => native.prepare(sql).get(...params),
      run: (sql, params = []) => native.prepare(sql).run(...params),
      exec: (sql) => native.exec(sql),
      close: () => native.close(),
    };
  }

  if (client === 'pg' || client === 'mysql2') {
    const knex = (await import('knex')).default;
    const k = knex({
      client,
      connection: {
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT || (client === 'pg' ? 5432 : 3306)),
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
      },
    });
    return {
      engine: client,
      all: (sql, params = []) => k.raw(sql, params).then((r) => r.rows ?? r),
      get: (sql, params = []) => k.raw(sql, params).then((r) => (r.rows ?? r)[0]),
      run: (sql, params = []) =>
        k.raw(sql, params).then((r) => ({
          changes: r.rowCount ?? r.affectedRows ?? 0,
          lastInsertRowid: r.insertId ?? (r.rows && r.rows.insertId) ?? 0,
        })),
      exec: (sql) => k.raw(sql).then(() => {}),
      close: () => k.destroy(),
    };
  }

  throw new Error(`不支持的 DB_CLIENT: ${client}`);
}

// 模块加载时即完成初始化（顶层 await，Node ESM 支持）
const db = await buildDb();
export default db;
export { client as dbClient };
