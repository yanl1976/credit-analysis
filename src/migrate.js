import db from '../config/database.js';

// 方言无关建表：sqlite3 / pg / mysql2 均由 Knex 适配，业务代码不写特定 SQL
async function createTables() {
  await db.schema.createTableIfNotExists('org', (t) => {
    t.increments('id');
    t.integer('parent_id').notNullable().defaultTo(0); // 0 = 根
    t.string('org_name', 128).notNullable();
    t.string('org_type', 16).notNullable(); // GROUP / SUB
    t.integer('level').notNullable().defaultTo(1);
    t.string('path', 255).notNullable().defaultTo('/'); // /1/3/7
    t.dateTime('created_at');
    t.dateTime('updated_at');
  });

  await db.schema.createTableIfNotExists('user', (t) => {
    t.increments('id');
    t.integer('org_id').notNullable();
    t.string('username', 64).notNullable().unique();
    t.string('password_hash', 128).notNullable();
    t.string('real_name', 64);
    t.integer('status').notNullable().defaultTo(1); // 1 启用 / 0 禁用
    t.dateTime('created_at');
  });

  await db.schema.createTableIfNotExists('role', (t) => {
    t.increments('id');
    t.integer('org_id').notNullable();
    t.string('role_key', 32).notNullable();
    t.string('role_name', 64).notNullable();
    t.string('description', 255);
    t.dateTime('created_at');
  });

  await db.schema.createTableIfNotExists('user_role', (t) => {
    t.integer('user_id').notNullable();
    t.integer('role_id').notNullable();
    t.primary(['user_id', 'role_id']);
  });

  await db.schema.createTableIfNotExists('permission', (t) => {
    t.increments('id');
    t.string('perm_key', 64).notNullable().unique();
    t.string('perm_name', 64).notNullable();
    t.string('description', 255);
  });

  await db.schema.createTableIfNotExists('role_permission', (t) => {
    t.integer('role_id').notNullable();
    t.integer('permission_id').notNullable();
    t.primary(['role_id', 'permission_id']);
  });

  await db.schema.createTableIfNotExists('partner', (t) => {
    t.increments('id');
    t.integer('owner_org_id').notNullable().defaultTo(0); // 数据隔离归属
    t.string('credit_code', 18).unique();
    t.string('name', 128).notNullable();
    t.text('alias_names'); // JSON 数组
    t.string('legal_person', 64);
    t.string('reg_status', 32);
    t.string('province', 32);
    t.string('industry', 64);
    t.dateTime('created_at');
    t.dateTime('updated_at');
  });

  await db.schema.createTableIfNotExists('partner_judicial', (t) => {
    t.increments('id');
    t.integer('partner_id').notNullable();
    t.string('case_type', 32); // 裁判/执行/失信/限高/破产
    t.string('role', 16); // plaintiff / defendant
    t.string('case_no', 64);
    t.string('court', 128);
    t.decimal('amount', 18, 2);
    t.string('status', 32);
    t.date('date');
    t.text('detail_json');
    t.dateTime('fetched_at');
  });

  await db.schema.createTableIfNotExists('partner_credit', (t) => {
    t.increments('id');
    t.integer('partner_id').notNullable();
    t.string('item_type', 32); // 经营异常/行政处罚/严重违法失信/税收违法
    t.string('authority', 128);
    t.string('reason', 255);
    t.string('penalty', 255);
    t.date('date');
    t.text('detail_json');
    t.dateTime('fetched_at');
  });

  await db.schema.createTableIfNotExists('partner_finance', (t) => {
    t.increments('id');
    t.integer('partner_id').notNullable();
    t.string('src', 32);
    t.string('rev_yoy', 32);
    t.string('profit', 32);
    t.string('scale_tag', 32);
    t.integer('employee_cnt');
    t.integer('bid_cnt');
    t.text('detail_json');
    t.dateTime('fetched_at');
  });

  await db.schema.createTableIfNotExists('partner_raw', (t) => {
    t.increments('id');
    t.integer('partner_id').notNullable();
    t.string('channel', 32);
    t.string('biz_key', 128);
    t.text('payload_json');
    t.dateTime('fetched_at');
  });

  await db.schema.createTableIfNotExists('partner_rating', (t) => {
    t.integer('partner_id').primary();
    t.integer('score');
    t.string('grade', 8); // AAA/AA/A/B/C/D
    t.string('risk_level', 8); // 低/中/高/极高
    t.integer('veto').notNullable().defaultTo(0);
    t.text('reasons'); // JSON 明细
    t.string('calc_version', 16);
    t.dateTime('calculated_at');
  });

  await db.schema.createTableIfNotExists('fetch_task', (t) => {
    t.increments('id');
    t.integer('partner_id').notNullable();
    t.string('channel', 32);
    t.string('status', 16);
    t.integer('cost_ms');
    t.text('err_msg');
    t.dateTime('created_at');
  });

  await db.schema.createTableIfNotExists('risk_event', (t) => {
    t.increments('id');
    t.integer('partner_id').notNullable();
    t.string('event_type', 32);
    t.string('old_grade', 8);
    t.string('new_grade', 8);
    t.text('detail');
    t.dateTime('created_at');
  });
}

async function main() {
  try {
    await createTables();
    console.log('[migrate] 全部数据表已就绪');
  } catch (e) {
    console.error('[migrate] 建表失败:', e.message);
    process.exit(1);
  } finally {
    await db.destroy();
  }
}

main();
