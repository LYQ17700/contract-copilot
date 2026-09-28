import { NotFoundError } from '../domain/errors.mjs';

/**
 * 极简路由：支持 :param 与 * 通配。签名与 Express 接近，后续换框架成本很低。
 *
 * @owner 后端 A
 */
export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler, { label } = {}) {
    const keys = [];
    const source = pattern
      .replace(/\/+$/, '')
      .replace(/:([A-Za-z0-9_]+)/g, (_, key) => {
        keys.push(key);
        return '([0-9a-zA-Z_.-]+)';
      })
      .replace(/\*/g, '(.*)');
    this.routes.push({ method, pattern, handler, keys, regex: new RegExp('^' + (source || '/') + '/?$'), label: label || pattern });
    return this;
  }

  get(p, h, o) { return this.add('GET', p, h, o); }
  post(p, h, o) { return this.add('POST', p, h, o); }
  del(p, h, o) { return this.add('DELETE', p, h, o); }

  match(method, pathname) {
    const path = pathname.replace(/\/+$/, '') || '/';
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const hit = route.regex.exec(path);
      if (!hit) continue;
      const params = {};
      route.keys.forEach((key, i) => {
        params[key] = decodeURIComponent(hit[i + 1]);
      });
      return { route, params };
    }
    return null;
  }

  /** 供 /__routes 调试接口与文档生成使用。 */
  table() {
    return this.routes.map((r) => ({ method: r.method, path: r.pattern, label: r.label }));
  }

  notFound(pathname) {
    return new NotFoundError('没有匹配的路由：' + pathname);
  }
}
