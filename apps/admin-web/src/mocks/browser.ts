/**
 * MSW Browser Worker 初始化
 *
 * 注意：使用前需要先运行 `npx msw init public/ --save`
 * 来生成 mockServiceWorker.js 到 public 目录。
 */
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';

export const worker = setupWorker(...handlers);
