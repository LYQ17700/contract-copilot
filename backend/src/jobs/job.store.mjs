import { newId, assertJobRecord, JOB_STATE } from '../domain/contracts.mjs';

/**
 * 内存任务表（进程重启即丢）。接口形状按“可替换为 Redis/DB”设计：
 * 只依赖 create/advance/finish/get，换实现时不动控制器。
 *
 * @owner 后端 A
 * @todo(后端A-3) 换持久化实现 + 并发 worker；当前 async=1 只是把 Promise 挂在内存里
 */
export class MemoryJobStore {
  constructor({ ttlMs = 30 * 60 * 1000 } = {}) {
    this.jobs = new Map();
    this.ttlMs = ttlMs;
  }

  create({ documentId, kind = 'extract' }) {
    const job = assertJobRecord({
      id: newId('job'),
      documentId,
      kind,
      state: JOB_STATE[0],
      steps: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    this.jobs.set(job.id, job);
    return job;
  }

  get(id) {
    return this.jobs.get(id) || null;
  }

  advance(id, steps) {
    const job = this.jobs.get(id);
    if (!job) return null;
    job.steps = steps;
    job.state = 'running';
    job.updatedAt = new Date().toISOString();
    return job;
  }

  finish(id, { result, error }) {
    const job = this.jobs.get(id);
    if (!job) return null;
    job.state = error ? 'failed' : 'succeeded';
    job.result = result;
    job.error = error ? { message: error.message, code: error.code || 'error' } : undefined;
    job.updatedAt = new Date().toISOString();
    return job;
  }

  list({ limit = 20 } = {}) {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  sweep() {
    const cutoff = Date.now() - this.ttlMs;
    for (const [id, job] of this.jobs) {
      if (Date.parse(job.updatedAt) < cutoff) this.jobs.delete(id);
    }
  }
}
