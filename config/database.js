import 'dotenv/config';
import knex from 'knex';

// 方言无关的数据访问层入口：开发期 sqlite3，信创期切 pg / mysql2（连接配置外置 .env）
const client = (process.env.DB_CLIENT || 'sqlite3').toLowerCase();

const base = {
  client,
  useNullAsDefault: true, // sqlite3 需要
};

if (client === 'sqlite3') {
  base.connection = { filename: process.env.DB_FILENAME || './data/credit_analysis.sqlite' };
} else if (client === 'pg') {
  base.client = 'pg';
  base.connection = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  };
} else if (client === 'mysql2') {
  base.client = 'mysql2';
  base.connection = {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  };
} else {
  throw new Error(`不支持的 DB_CLIENT: ${client}`);
}

const db = knex(base);

export default db;
export { client as dbClient };
