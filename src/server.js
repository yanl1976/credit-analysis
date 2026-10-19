import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import express from 'express';
import db from './config/database.js';
import { appConfig } from './config/app.js';
import { createTables } from './migrate.js';

const app = express();
app.use(express.json());

// 确保 sqlite 数据目录存在（信创 pg/mysql2 模式无需此步）
if ((process.env.DB_CLIENT || 'sqlite3').toLowerCase() === 'sqlite3') {
  const file = process.env.DB_FILENAME || './data/credit_analysis.sqlite';
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// 健康检查：数据库连通性
app.get('/health', async (req, res) => {
  try {
    await db.raw('select 1');
    res.json({ status: 'ok', db: 'up', time: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ status: 'error', db: 'down', message: e.message });
  }
});

// 启动：先确保表结构就绪，再监听端口
(async () => {
  try {
    await createTables();
    app.listen(appConfig.port, () => {
      console.log(`[server] 合作方资信分析系统已启动: http://localhost:${appConfig.port}`);
    });
  } catch (e) {
    console.error('[server] 启动失败:', e.message);
    process.exit(1);
  }
})();
