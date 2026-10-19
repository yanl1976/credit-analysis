import 'dotenv/config';
import express from 'express';
import db from './db.js';
import { appConfig } from '../config/app.js';
import { createTables } from './migrate.js';

const app = express();
app.use(express.json());

// 健康检查：数据库连通性
app.get('/health', (req, res) => {
  try {
    db.get('SELECT 1 AS ok');
    res.json({ status: 'ok', db: 'up', engine: db.engine, time: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ status: 'error', db: 'down', message: e.message });
  }
});

(async () => {
  try {
    await createTables();
    app.listen(appConfig.port, () => {
      console.log(`[server] 合作方资信分析系统已启动: http://localhost:${appConfig.port} (db engine: ${db.engine})`);
    });
  } catch (e) {
    console.error('[server] 启动失败:', e.message);
    process.exit(1);
  }
})();
