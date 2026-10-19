import 'dotenv/config';
import mysql from 'mysql2/promise';

// 统一数据访问层（MySQL 8 / mysql2 驱动，纯 JS 无需编译）
// 业务代码只调用 db.all/get/run/exec；信创期切换达梦/人大金仓（MySQL 兼容协议）时仅需改连接参数。
const host = process.env.DB_HOST || '127.0.0.1';
const port = Number(process.env.DB_PORT || 3306);
const user = process.env.DB_USER || 'root';
const password = process.env.DB_PASSWORD || '';
const database = process.env.DB_NAME || 'credit_analysis';

// 先确保目标数据库存在（连接时不指定 database，避免库不存在直接失败）
async function ensureDatabase() {
  const conn = await mysql.createConnection({ host, port, user, password });
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci`,
    );
  } finally {
    await conn.end();
  }
}

await ensureDatabase();

const pool = mysql.createPool({
  host,
  port,
  user,
  password,
  database,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  namedPlaceholders: false,
  // DATE/DATETIME 以字符串返回，避免 mysql2 转 Date 后按本地时区序列化造成日期偏移
  dateStrings: true,
});

const db = {
  engine: 'mysql2',
  all: async (sql, params = []) => {
    const [rows] = await pool.query(sql, params);
    return rows;
  },
  get: async (sql, params = []) => {
    const [rows] = await pool.query(sql, params);
    return rows[0];
  },
  run: async (sql, params = []) => {
    const [result] = await pool.query(sql, params);
    return {
      changes: result.affectedRows ?? 0,
      lastInsertRowid: result.insertId ?? 0,
    };
  },
  exec: async (sql) => {
    await pool.query(sql);
  },
  close: () => pool.end(),
};

export default db;
