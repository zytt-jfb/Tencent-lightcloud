// 本地双链路验证：报表上传链 + 成本上传链 + 跨用户 403。
// 默认依赖 3100 端口隔离实例；可用 BASE 环境变量覆盖（如 3200 最新代码实例）。
// 运行：cd apps/api && node test/dual-chain-verify.mjs
import * as XLSX from 'xlsx';

const BASE = process.env.BASE || 'http://127.0.0.1:3100/api';
const CITY_ID = 1; // 淄博
const YEAR = 2026;

let passed = 0;
let failed = 0;
function check(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  ✔ ${name}`); }
  else { failed++; console.log(`  x FAIL: ${name} ${extra}`); }
}

async function api(path, { method = 'GET', token, json, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form !== undefined) body = form;
  const res = await fetch(`${BASE}${path}`, { method, headers, body });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function reportXlsxBuffer() {
  const header1 = ['', '合同名称', '合同编码', '地市', '单位'];
  const header2 = ['序号', '名称', '编码', '城市', '计量单位'];
  for (let month = 1; month <= 12; month += 1) {
    header1.push(`${month}月`, `${month}月`);
    header2.push('完成', '验收');
  }
  const data = ['', '测试合同3', 'HT-T3', '淄博', ''];
  for (let month = 1; month <= 12; month += 1) data.push(month === 1 ? 100 : null, month === 1 ? 90 : null);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header1, header2, data]), '合同订单明细表');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(costRows(100)), '成本测算表');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function costRows(amount) {
  const header = ['类别'];
  const data = ['水电费'];
  for (let month = 1; month <= 12; month += 1) { header.push(`${month}月`); data.push(month === 1 ? amount : null); }
  return [header, data];
}
function costXlsxBuffer() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(costRows(125)), '成本测算表');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function sessionFromToken(variableName) {
  const token = process.env[variableName];
  if (!token) throw new Error(`必须通过 ${variableName} 提供 root_admin 预建的隔离 city_user 令牌`);
  const me = await api('/me', { token });
  if (me.status !== 200 || me.data?.role !== 'city_user') throw new Error(`${variableName} 不是有效 city_user 会话`);
  return { token, id: me.data.id, cityId: me.data.cityId };
}

async function uploadJob(token, jobType, buf, filename) {
  const form = new FormData();
  form.append('file', new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
  form.append('jobType', jobType);
  form.append('reportYear', String(YEAR));
  return api('/city/import-jobs', { method: 'POST', token, form });
}

async function runChain(label, user, jobType, buf, filename) {
  console.log(`\n[链路] ${label}（用户 #${user.id}）`);
  const created = await uploadJob(user.token, jobType, buf, filename);
  check(`${label} 创建作业 2xx`, created.status === 201 || created.status === 200, `status=${created.status} ${JSON.stringify(created.data)}`);
  const jobId = created.data?.jobId;
  check(`${label} 返回 jobId`, typeof jobId === 'number');
  check(`${label} operator=本人`, created.data?.operatorUserId === user.id, `got=${created.data?.operatorUserId}`);
  check(`${label} cityId=作业绑定地市`, created.data?.cityId === CITY_ID, `got=${created.data?.cityId}`);
  check(`${label} reportYear=作业绑定年份`, created.data?.reportYear === YEAR, `got=${created.data?.reportYear}`);

  const got = await api(`/city/import-jobs/${jobId}`, { token: user.token });
  check(`${label} 详情 operator=本人`, got.data?.operatorUserId === user.id);

  const prev = await api(`/city/import-jobs/${jobId}/preview`, { token: user.token });
  check(`${label} 预览 2xx`, prev.status === 200, `status=${prev.status}`);
  check(`${label} 预览校验通过`, prev.data?.parsedSummary?.validation?.isValid === true, JSON.stringify(prev.data));
  check(`${label} 预览含 parsedSummary/status`, prev.data && 'parsedSummary' in prev.data && 'status' in prev.data);

  const conf = await api(`/city/import-jobs/${jobId}/confirm`, { method: 'POST', token: user.token, json: { confirmOverwrite: true } });
  const confOk = (conf.status === 200 || conf.status === 201) && conf.data?.success === true;
  check(`${label} 确认写入成功`, confOk, `status=${conf.status} ${JSON.stringify(conf.data)}`);
  console.log(`    确认结果: status=${conf.status} body=${JSON.stringify(conf.data)}`);
  const finalJob = await api(`/city/import-jobs/${jobId}`, { token: user.token });
  check(`${label} 最终状态 completed`, finalJob.data?.status === 'completed', JSON.stringify(finalJob.data));
  return jobId;
}

async function main() {
  console.log(`===== 本地双链路验证 (${BASE}, 隔离DB) =====`);
  const userA = await sessionFromToken('DUAL_CHAIN_CITY_USER_A_TOKEN');
  const userB = await sessionFromToken('DUAL_CHAIN_CITY_USER_B_TOKEN');
  console.log(`userA=#${userA.id} userB=#${userB.id} city=${CITY_ID}`);

  const reportJobId = await runChain('报表上传链', userA, 'city_reporting', reportXlsxBuffer(), 'report.xlsx');
  await runChain('成本上传链', userA, 'city_cost', costXlsxBuffer(), 'cost.xlsx');

  console.log('\n[权限] 跨用户访问隔离');
  const bGet = await api(`/city/import-jobs/${reportJobId}`, { token: userB.token });
  check('userB 读取 userA 作业 → 403', bGet.status === 403, `status=${bGet.status}`);
  check('403 中文错误=其他用户任务', typeof bGet.data?.message === 'string' && bGet.data.message.includes('其他用户'), `msg=${bGet.data?.message}`);
  const bConfirm = await api(`/city/import-jobs/${reportJobId}/confirm`, { method: 'POST', token: userB.token, json: { confirmOverwrite: true } });
  check('userB 确认 userA 作业 → 403', bConfirm.status === 403, `status=${bConfirm.status}`);
  const bPrev = await api(`/city/import-jobs/${reportJobId}/preview`, { token: userB.token });
  check('userB 预览 userA 作业 → 403', bPrev.status === 403, `status=${bPrev.status}`);

  console.log(`\n===== 结果：通过 ${passed}，失败 ${failed} =====`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error('验证脚本异常：', e); process.exit(2); });
