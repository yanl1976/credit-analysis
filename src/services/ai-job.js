import { randomUUID } from 'node:crypto';
import { aiCollect, searchCompanyCandidates } from './ai-service.js';

// AI 检索的异步任务（进程内）：一次检索要跑联网搜索 + 大模型抽取，通常 1~3 分钟。
// 前端不便长时间挂着一个 HTTP 请求（易被网关/浏览器超时切断），改为「提交任务 + 轮询进度」。
// 说明：任务状态存在进程内，重启即丢；结果本身已落库（partner_raw + 三个维度表），不依赖此状态。

const jobs = new Map();
const KEEP_MS = 10 * 60 * 1000;

function prune() {
  const now = Date.now();
  for (const [id, j] of jobs) {
    if (j.finishedAt && now - j.finishedAt > KEEP_MS) jobs.delete(id);
  }
}

function createJob(kind, extra = {}) {
  prune();
  const job = {
    id: randomUUID(),
    kind,
    ...extra,
    status: 'running',
    progress: 0,
    step: '准备中',
    startedAt: Date.now(),
    finishedAt: null,
    result: null,
    error: null,
  };
  jobs.set(job.id, job);
  return job;
}

function summarize(job) {
  return { jobId: job.id, status: job.status, progress: job.progress, step: job.step };
}

export function startAiCollectJob(partnerId) {
  const job = createJob('collect', { partnerId: Number(partnerId) });

  // 后台执行，不阻塞 HTTP 响应
  (async () => {
    try {
      job.result = await aiCollect(job.partnerId, (progress, step) => {
        if (Number.isFinite(progress)) job.progress = Math.max(job.progress, Math.min(progress, 99));
        if (step) job.step = step;
      });
      job.status = 'done';
      job.progress = 100;
      job.step = '完成';
    } catch (e) {
      job.status = 'error';
      job.step = '执行失败';
      job.error = e.message;
    } finally {
      job.finishedAt = Date.now();
    }
  })();

  return summarize(job);
}

// 新建客户：按名称搜索候选企业（多家），异步执行避免前端超时
export function startAiSearchJob(name) {
  const job = createJob('search', { name: String(name || '') });

  (async () => {
    try {
      job.step = '联网检索与识别中（约 1~3 分钟）';
      job.progress = 30;
      job.result = await searchCompanyCandidates(job.name);
      job.status = 'done';
      job.progress = 100;
      job.step = '完成';
    } catch (e) {
      job.status = 'error';
      job.step = '执行失败';
      job.error = e.message;
    } finally {
      job.finishedAt = Date.now();
    }
  })();

  return summarize(job);
}

export function getAiJob(jobId) {
  const job = jobs.get(String(jobId || ''));
  if (!job) return null;
  return {
    jobId: job.id,
    kind: job.kind || 'collect',
    partnerId: job.partnerId,
    status: job.status,
    progress: job.progress,
    step: job.step,
    elapsedMs: (job.finishedAt || Date.now()) - job.startedAt,
    result: job.status === 'done' ? job.result : undefined,
    error: job.error || undefined,
  };
}
