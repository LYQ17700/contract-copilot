import fs from 'node:fs';
import path from 'node:path';

/**
 * 文件存储抽象。默认本地磁盘实现；换 S3/OSS 时实现同样的方法即可。
 * 落盘文件名只用内部 id，绝不使用用户上传的文件名，避免路径穿越。
 *
 * @owner 后端 A
 */
export class LocalStorage {
  constructor(rootDir) {
    this.rootDir = rootDir;
    fs.mkdirSync(rootDir, { recursive: true });
  }

  keyFor(id, extension) {
    return id + (extension ? '.' + extension : '');
  }

  async put({ id, extension, buffer }) {
    const key = this.keyFor(id, extension);
    const target = path.join(this.rootDir, key);
    await fs.promises.writeFile(target, buffer);
    return { key, path: target };
  }

  async get({ id, extension }) {
    return fs.promises.readFile(path.join(this.rootDir, this.keyFor(id, extension)));
  }

  async exists({ id, extension }) {
    return fs.existsSync(path.join(this.rootDir, this.keyFor(id, extension)));
  }

  async putMeta({ id, meta }) {
    await fs.promises.writeFile(path.join(this.rootDir, id + '.meta.json'), JSON.stringify(meta, null, 2), 'utf8');
  }

  async readMeta({ id }) {
    const file = path.join(this.rootDir, id + '.meta.json');
    if (!fs.existsSync(file)) return null;
    return JSON.parse(await fs.promises.readFile(file, 'utf8'));
  }

  async listIds() {
    return fs
      .readdirSync(this.rootDir)
      .filter((name) => name.endsWith('.meta.json'))
      .map((name) => name.replace(/\.meta\.json$/, ''));
  }
}
