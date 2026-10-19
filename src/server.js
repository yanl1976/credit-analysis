import 'dotenv/config';
import express from 'express';
import db from './db.js';
import { appConfig } from '../config/app.js';
import { createTables } from './migrate.js';
import orgRoutes from './routes/org.js';
import userRoutes from './routes/user.js';
import roleRoutes from './routes/role.js';
import permissionRoutes from './routes/permission.js';
import authRoutes from './routes/auth.js';
import channelsRoutes from './routes/channels.js';
import partnerRoutes from './routes/partner.js';
import { initChannels } from './channels/index.js';

const app = express();
app.use(express.json());

// 健康检查：数据库连通性
app.get('/health', async (req, res) => {
  try {
    await db.get('SELECT 1 AS ok');
    res.json({ status: 'ok', db: 'up', engine: db.engine, time: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ status: 'error', db: 'down', message: e.message });
  }
});

// 业务路由
app.use('/api/orgs', orgRoutes);
app.use('/api/users', userRoutes);
app.use('/api/roles', roleRoutes);
app.use('/api/permissions', permissionRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/channels', channelsRoutes);
app.use('/api/partners', partnerRoutes);

// 统一错误处理（放在所有路由之后）
app.use((err, req, res, next) => {
  console.error('[server] 请求错误:', err.message);
  res.status(500).json({ code: 500, message: err.message });
});

(async () => {
  try {
    await createTables();
    initChannels();
    app.listen(appConfig.port, () => {
      console.log(`[server] 合作方资信分析系统已启动: http://localhost:${appConfig.port} (db: ${db.engine})`);
    });
  } catch (e) {
    console.error('[server] 启动失败:', e.message);
    process.exit(1);
  }
})();
