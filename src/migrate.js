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
    admission_status VARCHAR(16) NOT NULL DEFAULT 'NORMAL',
    next_review_date DATE NULL,
    data_source VARCHAR(16) NOT NULL DEFAULT 'manual',
    created_at DATETIME NULL,
    updated_at DATETIME NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uk_partner_credit_code (credit_code),
    KEY idx_partner_admission (admission_status),
    KEY idx_partner_next_review (next_review_date)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS partner_judicial (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    partner_id INT UNSIGNED NOT NULL,
    case_type VARCHAR(32) NULL,
    party_role VARCHAR(16) NULL,
    plaintiff VARCHAR(255) NULL,
    defendant VARCHAR(255) NULL,
    doc_title VARCHAR(255) NULL,
    judge_result TEXT NULL,
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
    src VARCHAR(64) NULL,
    stock_code VARCHAR(16) NULL,
    report_period VARCHAR(16) NULL,
    listed_status VARCHAR(16) NULL,
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

  `CREATE TABLE IF NOT EXISTS sys_setting (
    setting_key VARCHAR(64) NOT NULL,
    setting_value TEXT NULL,
    description VARCHAR(200) NULL,
    updated_at DATETIME NULL,
    PRIMARY KEY (setting_key)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS partner_rating_history (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    partner_id INT UNSIGNED NOT NULL,
    score INT NULL,
    grade VARCHAR(8) NULL,
    risk_level VARCHAR(8) NULL,
    veto TINYINT NOT NULL DEFAULT 0,
    reasons TEXT NULL,
    calc_version VARCHAR(16) NULL,
    calculated_at DATETIME NULL,
    PRIMARY KEY (id),
    KEY idx_rating_history_partner (partner_id, id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS fetch_task (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    partner_id INT UNSIGNED NOT NULL,
    channel VARCHAR(32) NULL,
    status VARCHAR(16) NULL,
    reason_code VARCHAR(32) NULL,
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
    status VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    handled_by INT UNSIGNED NULL,
    handled_at DATETIME NULL,
    handle_note VARCHAR(500) NULL,
    created_at DATETIME NULL,
    PRIMARY KEY (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

// 增量列（MySQL 不支持 ADD COLUMN IF NOT EXISTS，用 information_schema 判断后补）
const COLUMN_UPGRADES = [
  {
    table: 'partner',
    column: 'data_source',
    sql: "ALTER TABLE partner ADD COLUMN data_source VARCHAR(16) NOT NULL DEFAULT 'manual' AFTER industry",
  },
  {
    table: 'partner_judicial',
    column: 'data_source',
    sql: "ALTER TABLE partner_judicial ADD COLUMN data_source VARCHAR(16) NOT NULL DEFAULT 'manual'",
  },
  {
    table: 'partner_judicial',
    column: 'plaintiff',
    sql: 'ALTER TABLE partner_judicial ADD COLUMN plaintiff VARCHAR(255) NULL AFTER party_role',
  },
  {
    table: 'partner_judicial',
    column: 'defendant',
    sql: 'ALTER TABLE partner_judicial ADD COLUMN defendant VARCHAR(255) NULL AFTER plaintiff',
  },
  {
    table: 'partner_judicial',
    column: 'doc_title',
    sql: 'ALTER TABLE partner_judicial ADD COLUMN doc_title VARCHAR(255) NULL AFTER defendant',
  },
  {
    table: 'partner_judicial',
    column: 'judge_result',
    sql: 'ALTER TABLE partner_judicial ADD COLUMN judge_result TEXT NULL AFTER doc_title',
  },
  {
    table: 'partner_credit',
    column: 'data_source',
    sql: "ALTER TABLE partner_credit ADD COLUMN data_source VARCHAR(16) NOT NULL DEFAULT 'manual'",
  },
  {
    table: 'partner_finance',
    column: 'data_source',
    sql: "ALTER TABLE partner_finance ADD COLUMN data_source VARCHAR(16) NOT NULL DEFAULT 'manual'",
  },
  {
    // 失败原因分类（欠费/额度/配置/代码/数据/网络），便于筛选与统计
    table: 'fetch_task',
    column: 'reason_code',
    sql: 'ALTER TABLE fetch_task ADD COLUMN reason_code VARCHAR(32) NULL AFTER status',
  },
  {
    // 上市公司/上市子公司财务线索：来源站点、股票代码、报告期、上市关系
    table: 'partner_finance',
    column: 'stock_code',
    sql: 'ALTER TABLE partner_finance ADD COLUMN stock_code VARCHAR(16) NULL AFTER src',
  },
  {
    table: 'partner_finance',
    column: 'report_period',
    sql: 'ALTER TABLE partner_finance ADD COLUMN report_period VARCHAR(16) NULL AFTER stock_code',
  },
  {
    table: 'partner_finance',
    column: 'listed_status',
    sql: 'ALTER TABLE partner_finance ADD COLUMN listed_status VARCHAR(16) NULL AFTER report_period',
  },
  // 预警处置闭环：未处理 / 处理中 / 已关闭 + 处理人与备注
  {
    table: 'risk_event',
    column: 'status',
    sql: "ALTER TABLE risk_event ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'OPEN' AFTER detail",
  },
  {
    table: 'risk_event',
    column: 'handled_by',
    sql: 'ALTER TABLE risk_event ADD COLUMN handled_by INT UNSIGNED NULL AFTER status',
  },
  {
    table: 'risk_event',
    column: 'handled_at',
    sql: 'ALTER TABLE risk_event ADD COLUMN handled_at DATETIME NULL AFTER handled_by',
  },
  {
    table: 'risk_event',
    column: 'handle_note',
    sql: 'ALTER TABLE risk_event ADD COLUMN handle_note VARCHAR(500) NULL AFTER handled_at',
  },
  // 准入状态（正常/关注/重点监控/黑名单）：风险名单与列表筛选依据
  {
    table: 'partner',
    column: 'admission_status',
    sql: "ALTER TABLE partner ADD COLUMN admission_status VARCHAR(16) NOT NULL DEFAULT 'NORMAL' AFTER industry",
  },
  // 下次评估日期：定期复审的临期/逾期判定基准
  {
    table: 'partner',
    column: 'next_review_date',
    sql: 'ALTER TABLE partner ADD COLUMN next_review_date DATE NULL AFTER admission_status',
  },
];

async function ensureColumns() {
  for (const u of COLUMN_UPGRADES) {
    const row = await db.get(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
      [u.table, u.column],
    );
    if (!Number(row?.c)) await db.exec(u.sql);
  }
}

export async function createTables() {
  for (const sql of DDL) {
    if (sql.trim()) await db.exec(sql);
  }
  await ensureColumns();
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
