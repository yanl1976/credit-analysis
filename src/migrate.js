import db from './db.js';

// MySQL 8 建表 DDL（utf8mb4 / InnoDB）。
// 表名避开 MySQL 保留字：user/role → sys_user/sys_role；字段 role → party_role。
const DDL = [
  `CREATE TABLE IF NOT EXISTS org (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    parent_id INT UNSIGNED NOT NULL DEFAULT 0,
    org_name VARCHAR(128) NOT NULL,
    org_type VARCHAR(16) NOT NULL,
    level INT NOT NULL DEFAULT 1,
    path VARCHAR(255) NOT NULL DEFAULT '/',
    created_at DATETIME NULL,
    updated_at DATETIME NULL,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS sys_user (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    org_id INT UNSIGNED NOT NULL,
    username VARCHAR(64) NOT NULL,
    password_hash VARCHAR(128) NOT NULL,
    real_name VARCHAR(64) NULL,
    status TINYINT NOT NULL DEFAULT 1,
    created_at DATETIME NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_sys_user_username (username)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS sys_role (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    org_id INT UNSIGNED NOT NULL,
    role_key VARCHAR(32) NOT NULL,
    role_name VARCHAR(64) NOT NULL,
    description VARCHAR(255) NULL,
    created_at DATETIME NULL,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS sys_user_role (
    user_id INT UNSIGNED NOT NULL,
    role_id INT UNSIGNED NOT NULL,
    PRIMARY KEY (user_id, role_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS sys_permission (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    perm_key VARCHAR(64) NOT NULL,
    perm_name VARCHAR(64) NOT NULL,
    description VARCHAR(255) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_sys_permission_key (perm_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS sys_role_permission (
    role_id INT UNSIGNED NOT NULL,
    permission_id INT UNSIGNED NOT NULL,
    PRIMARY KEY (role_id, permission_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS partner (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    owner_org_id INT UNSIGNED NOT NULL DEFAULT 0,
    credit_code VARCHAR(18) NULL,
    name VARCHAR(128) NOT NULL,
    alias_names TEXT NULL,
    legal_person VARCHAR(64) NULL,
    reg_status VARCHAR(32) NULL,
    province VARCHAR(32) NULL,
    industry VARCHAR(64) NULL,
    created_at DATETIME NULL,
    updated_at DATETIME NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_partner_credit_code (credit_code)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS partner_judicial (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    partner_id INT UNSIGNED NOT NULL,
    case_type VARCHAR(32) NULL,
    party_role VARCHAR(16) NULL,
    case_no VARCHAR(64) NULL,
    court VARCHAR(128) NULL,
    amount DECIMAL(18,2) NULL,
    status VARCHAR(32) NULL,
    date DATE NULL,
    detail_json TEXT NULL,
    fetched_at DATETIME NULL,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS partner_credit (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    partner_id INT UNSIGNED NOT NULL,
    item_type VARCHAR(32) NULL,
    authority VARCHAR(128) NULL,
    reason VARCHAR(255) NULL,
    penalty VARCHAR(255) NULL,
    date DATE NULL,
    detail_json TEXT NULL,
    fetched_at DATETIME NULL,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS partner_finance (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    partner_id INT UNSIGNED NOT NULL,
    src VARCHAR(32) NULL,
    rev_yoy VARCHAR(32) NULL,
    profit VARCHAR(32) NULL,
    scale_tag VARCHAR(32) NULL,
    employee_cnt INT NULL,
    bid_cnt INT NULL,
    detail_json TEXT NULL,
    fetched_at DATETIME NULL,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS partner_raw (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    partner_id INT UNSIGNED NOT NULL,
    channel VARCHAR(32) NULL,
    biz_key VARCHAR(128) NULL,
    payload_json LONGTEXT NULL,
    fetched_at DATETIME NULL,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS partner_rating (
    partner_id INT UNSIGNED NOT NULL,
    score INT NULL,
    grade VARCHAR(8) NULL,
    risk_level VARCHAR(8) NULL,
    veto TINYINT NOT NULL DEFAULT 0,
    reasons TEXT NULL,
    calc_version VARCHAR(16) NULL,
    calculated_at DATETIME NULL,
    PRIMARY KEY (partner_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS fetch_task (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    partner_id INT UNSIGNED NOT NULL,
    channel VARCHAR(32) NULL,
    status VARCHAR(16) NULL,
    cost_ms INT NULL,
    err_msg TEXT NULL,
    created_at DATETIME NULL,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS risk_event (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    partner_id INT UNSIGNED NOT NULL,
    event_type VARCHAR(32) NULL,
    old_grade VARCHAR(8) NULL,
    new_grade VARCHAR(8) NULL,
    detail TEXT NULL,
    created_at DATETIME NULL,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

export async function createTables() {
  for (const sql of DDL) {
    if (sql.trim()) await db.exec(sql);
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
    await db.close();
  }
}

// 仅当直接运行 `node src/migrate.js` 时才建表并关闭连接；
// 被 server.js 引入（仅取 createTables）时不要自动执行 main，否则会关闭共享连接池
if (process.argv[1] && process.argv[1].endsWith('migrate.js')) {
  main();
}
