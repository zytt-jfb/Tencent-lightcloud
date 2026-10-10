/**
 * MSW 请求处理器 — 所有 Mock API 处理器
 *
 * 【约束 1】所有响应结构严格对齐后端契约，字段从 shared-types 导入
 * 【约束 4】通过环境变量 VITE_ENABLE_MSW 控制开关
 *
 * 所有 handler 名称以 handle 前缀命名，便于识别。
 */
import { http, HttpResponse } from 'msw';
import { Role, UserStatus } from '@biz-reporting/shared-types';
import type { CreateContractRequest, UpdateContractRequest } from '@biz-reporting/shared-types';
import {
  mockLoginResponse, mockLoginAccounts,
  mockMeResponse,
  mockContracts,
  mockUserList,
  mockUserListResponse,
  mockDashboardStats,
  buildPaginatedResponse,
} from './data';

// 内存态状态（支持简单 CRUD 操作）
const contracts = [...mockContracts];
let nextContractId = mockContracts.length + 1;
const users = [...mockUserList];

export const handlers = [
  // ----------------------------------------------------------
  // Auth
  // ----------------------------------------------------------

  /** POST /api/auth/admin/login */
  http.post('/api/auth/admin/login', async ({ request }) => {
    const body = (await request.json()) as { username: string; password: string };
    if (body.username !== 'admin' || body.password !== 'admin123456') {
      const account = Object.values(mockLoginAccounts).find((item) =>
        item.username === body.username && item.password === body.password,
      );
      if (!account) {
        return HttpResponse.json({ code: 401, message: '账号或密码错误' }, { status: 401 });
      }
      if (account.meResponse.status === UserStatus.DISABLED) {
        return HttpResponse.json({ code: 403, message: '账号已停用' }, { status: 403 });
      }
      return HttpResponse.json(account.loginResponse);
    }
    // Mock 模式下接受任意用户名密码
    if (!body.username || !body.password) {
      return HttpResponse.json(
        { code: 400, message: '用户名和密码不能为空' },
        { status: 400 },
      );
    }
    return HttpResponse.json(mockLoginResponse);
  }),

  /** POST /api/auth/city/login */
  http.post('/api/auth/city/login', async ({ request }) => {
    const body = (await request.json()) as { username: string; password: string };
    const account = Object.values(mockLoginAccounts).find((item) =>
      item.meResponse.role === Role.CITY_USER &&
      item.username === body.username &&
      item.password === body.password,
    );
    if (!account) {
      return HttpResponse.json({ code: 401, message: '地市账号或密码错误' }, { status: 401 });
    }
    if (account.meResponse.status === UserStatus.DISABLED) {
      return HttpResponse.json({ code: 403, message: '地市账号已停用' }, { status: 403 });
    }
    return HttpResponse.json(account.loginResponse);
  }),

  /** GET /api/cities */
  http.get('/api/cities', () => {
    return HttpResponse.json([
      { id: 1, name: '淄博' },
      { id: 2, name: '济南' },
      { id: 3, name: '德州' },
    ]);
  }),
  /** GET /api/me */
  http.get('/api/me', ({ request }) => {
    const authorization = request.headers.get('authorization') ?? '';
    if (authorization.includes(mockLoginResponse.token)) {
      return HttpResponse.json(mockMeResponse);
    }
    const account = Object.values(mockLoginAccounts).find((item) =>
      authorization.includes(item.loginResponse.token),
    );
    return account
      ? HttpResponse.json(account.meResponse)
      : HttpResponse.json({ code: 401, message: '模拟登录状态已失效' }, { status: 401 });
  }),

  // ----------------------------------------------------------
  // Dashboard
  // ----------------------------------------------------------

  /** GET /api/admin/dashboard */
  http.get('/api/admin/dashboard', () => {
    return HttpResponse.json(mockDashboardStats);
  }),

  // ----------------------------------------------------------
  // Contracts
  // ----------------------------------------------------------

  /** GET /api/admin/contracts — 分页列表 */
  http.get('/api/admin/contracts', ({ request }) => {
    const url = new URL(request.url);
    const page = Number(url.searchParams.get('page')) || 1;
    const pageSize = Number(url.searchParams.get('pageSize')) || 20;
    // 排除已软删除的合同
    const active = contracts.filter((c) => !c.isDeleted);
    return HttpResponse.json(buildPaginatedResponse(active, page, pageSize));
  }),

  /** GET /api/admin/contracts/:id — 详情 */
  http.get('/api/admin/contracts/:contractId', ({ params }) => {
    const id = Number(params.contractId);
    const contract = contracts.find((c) => c.id === id);
    if (!contract) {
      return HttpResponse.json(
        { code: 404, message: '合同不存在' },
        { status: 404 },
      );
    }
    return HttpResponse.json(contract);
  }),

  /** POST /api/admin/contracts — 创建 */
  http.post('/api/admin/contracts', async ({ request }) => {
    const body = (await request.json()) as CreateContractRequest;
    const newContract = {
      id: nextContractId++,
      contractCode: body.contractCode,
      contractName: body.contractName,
      contractAmount: body.contractAmount,
      rate: body.rate,
      accumulatedOrderAmount: 0,
      accumulatedInvoiceAmount: 0,
      signDate: body.signDate ? new Date(body.signDate) : null,
      expireDate: body.expireDate ? new Date(body.expireDate) : null,
      isDeleted: false,
      deletedAt: null,
      createdBy: 1,
      updatedBy: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    contracts.push(newContract);
    return HttpResponse.json(newContract, { status: 201 });
  }),

  /** PATCH /api/admin/contracts/:id — 更新 */
  http.patch('/api/admin/contracts/:contractId', async ({ params, request }) => {
    const id = Number(params.contractId);
    const body = (await request.json()) as UpdateContractRequest;
    const idx = contracts.findIndex((c) => c.id === id);
    if (idx === -1) {
      return HttpResponse.json(
        { code: 404, message: '合同不存在' },
        { status: 404 },
      );
    }
    contracts[idx] = {
      ...contracts[idx],
      ...body,
      signDate: body.signDate ? new Date(body.signDate) : contracts[idx].signDate,
      expireDate: body.expireDate ? new Date(body.expireDate) : contracts[idx].expireDate,
      updatedAt: new Date(),
    };
    return HttpResponse.json(contracts[idx]);
  }),

  /** DELETE /api/admin/contracts/:id — 软删除 */
  http.delete('/api/admin/contracts/:contractId', ({ params }) => {
    const id = Number(params.contractId);
    const idx = contracts.findIndex((c) => c.id === id);
    if (idx === -1) {
      return HttpResponse.json(
        { code: 404, message: '合同不存在' },
        { status: 404 },
      );
    }
    contracts[idx] = {
      ...contracts[idx],
      isDeleted: true,
      deletedAt: new Date(),
      updatedAt: new Date(),
    };
    return HttpResponse.json({ success: true });
  }),

  // ----------------------------------------------------------
  // Users
  // ----------------------------------------------------------

  /** GET /api/admin/users — 用户列表 */
  http.get('/api/admin/users', () => {
    return HttpResponse.json(mockUserListResponse);
  }),

  /** PATCH /api/admin/users/:id/status — 启用/禁用 */
  http.patch('/api/admin/users/:userId/status', async ({ params, request }) => {
    const id = Number(params.userId);
    const body = (await request.json()) as { status: UserStatus };
    const idx = users.findIndex((u) => u.id === id);
    if (idx === -1) {
      return HttpResponse.json(
        { code: 404, message: '用户不存在' },
        { status: 404 },
      );
    }
    users[idx] = { ...users[idx], status: body.status };
    return HttpResponse.json(users[idx]);
  }),

  // ----------------------------------------------------------
  // Packages (Admin)
  // ----------------------------------------------------------
  //
  // GET /api/admin/packages 不在冻结 OpenAPI 中。
  // 控制端点 (return-to-draft/unlock-months/open-current-month-contract) 已冻结，
  // mock 待列表接口恢复后补充。

];
