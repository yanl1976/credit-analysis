import db from './db.js';

// 建表 DDL（当前按 SQLite 语法；信创期切换时在 buildDb 分支外补充 pg/mysql2 DDL 即可）
const DDL = [
  `CREATE TABLE IF NOT EXISTS org (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    parent_id INTEGER NOT NULL DEFAULT 0,
    org_name VARCHAR(128) NOT NULL,
    org_type VARCHAR(16) NOT NULL,
    level INTEGER NOT NULL DEFAULT 1,
    path VARCHAR(255) NOT NULL DEFAULT '/',
    created_at DATETIME,
    updated_at DATETIME)`,

  `CREATE TABLE IF NOT EXISTS user (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL,
    username VARCHAR(64) NOT NULL UNIQUE,
    password_hash VARCHAR(128) NOT NULL,
    real_name VARCHAR(64),
    status INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME)`,

  `CREATE TABLE IF NOT EXISTS role (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    org_id INTEGER NOT NULL,
    role_key VARCHAR(32) NOT NULL,
    role_name VARCHAR(64) NOT NULL,
    description VARCHAR(255),
    created_at DATETIME)`,

  `CREATE TABLE IF NOT EXISTS user_role (
    user_id INTEGER NOT NULL,
    role_id INTEGER NOT NULL,
    PRIMARY KEY (user_id, role_id))`,

  `CREATE TABLE IF NOT EXISTS permission (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    perm_key VARCHAR(64) NOT NULL UNIQUE,
    perm_name VARCHAR(64) NOT NULL,
    description VARCHAR(255))`,

  `CREATE TABLE IF NOT EXISTS role_permission (
    role_id INTEGER NOT NULL,
    permission_id INTEGER NOT NULL,
    PRIMARY KEY (role_id, permission_id))`,

  `CREATE TABLE IF NOT EXISTS partner (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner_org_id INTEGER NOT NULL DEFAULT 0,
    credit_code VARCHAR(18) UNIQUE,
    name VARCHAR(128) NOT NULL,
    alias_names TEXT,
    legal_person VARCHAR(64),
    reg_status VARCHAR(32),
    province VARCHAR(32),
    industry VARCHAR(64),
    created_at DATETIME,
    updated_at DATETIME)`,

  `CREATE TABLE IF NOT EXISTS partner_judicial (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_id INTEGER NOT NULL,
    case_type VARCHAR(32),
    role VARCHAR(16),
    case_no VARCHAR(64),
    court VARCHAR(128),
    amount DECIMAL(18,2),
    status VARCHAR(32),
    date DATE,
    detail_json TEXT,
    fetched_at DATETIME)`,

  `CREATE TABLE IF NOT EXISTS partner_credit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_id INTEGER NOT NULL,
    item_type VARCHAR(32),
    authority VARCHAR(128),
    reason VARCHAR(255),
    penalty VARCHAR(255),
    date DATE,
    detail_json TEXT,
    fetched_at DATETIME)`,

  `CREATE TABLE IF NOT EXISTS partner_finance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_id INTEGER NOT NULL,
    src VARCHAR(32),
    rev_yoy VARCHAR(32),
    profit VARCHAR(32),
    scale_tag VARCHAR(32),
    employee_cnt INTEGER,
    bid_cnt INTEGER,
    detail_json TEXT,
    fetched_at DATETIME)`,

  `CREATE TABLE IF NOT EXISTS partner_raw (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_id INTEGER NOT NULL,
    channel VARCHAR(32),
    biz_key VARCHAR(128),
    payload_json TEXT,
    fetched_at DATETIME)`,

  `CREATE TABLE IF NOT EXISTS partner_rating (
    partner_id INTEGER PRIMARY KEY,
    score INTEGER,
    grade VARCHAR(8),
    risk_level VARCHAR(8),
    veto INTEGER NOT NULL DEFAULT 0,
    reasons TEXT,
    calc_version VARCHAR(16),
    calculated_at DATETIME)`,

  `CREATE TABLE IF NOT EXISTS fetch_task (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_id INTEGER NOT NULL,
    channel VARCHAR(32),
    status VARCHAR(16),
    cost_ms INTEGER,
    err_msg TEXT,
    created_at DATETIME)`,

  `CREATE TABLE IF NOT EXISTS risk_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partner_id INTEGER NOT NULL,
    event_type VARCHAR(32),
    old_grade VARCHAR(8),
    new_grade VARCHAR(8),
    detail TEXT,
    created_at DATETIME)`,
];

export async function createTables() {
  for (const sql of DDL) {
    if (sql.trim()) db.exec(sql);
  }
}

async function main() {
  try {
    await createTables();
    console.log('[migrate] 全部数据表已就绪');
  } catch (e) {
    console.error('[migrate] 建表失败:', e.message);
    process.exit(1);
  } finally {
    db.close();
  }
}

// 仅当直接运行 `node src/migrate.js` 时才建表并关闭连接；
// 被 server.js 引入（仅取 createTables）时不要自动执行 main，否则会关闭共享的 db 实例
if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  main();
}
