// 真实写入闭环验证：使用城市淄博(city_id=1)已分配的合同 HT-T3，报表确认应写入成功(success=true)。
// 验证环境：隔离实例(3200) + 隔离 DB 副本，绝不触碰 dev.sqlite / 3000 生产实例。
import * as XLSX from 'xlsx';
const BASE = process.env.BASE || 'http://127.0.0.1:3200/api';

async function api(path, { method = 'GET', token, json, form } = {}) {
  const headers = {}; if (token) headers.Authorization = `Bearer ${token}`;
  let body; if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form !== undefined) body = form;
  const res = await fetch(`${BASE}${path}`, { method, headers, body });
  const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

// 月度报表 sheet：前两行为表头(后端 rows.slice(0,2) 视为表头, 数据从 index2 起)；表头含 合同名称/合同编码/1月/12月。
// 数据行列布局=[空, 合同名称, 合同编码, 地市, 单位, 1月完成, 1月验收, ...]，与 detectMonthlyShape 对齐(nameIndex=1, codeIndex=2, monthStartIndex=5)。
function reportBuf() {
  const header1 = ['', '合同名称', '合同编码', '地市', '单位'];
  const header2 = ['序号', '名称', '编码', '城市', '计量单位'];
  for (let m = 1; m <= 12; m += 1) { header1.push(`${m}月`); header1.push(`${m}月`); header2.push('完成'); header2.push('验收'); }
  const data = ['', '测试合同3', 'HT-T3', '淄博', ''];
  for (let m = 1; m <= 12; m += 1) {
    if (m === 1) { data.push(100, 90); } else { data.push(null, null); }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header1, header2, data]), '合同订单明细表');

  // 成本测算 sheet：表头含 类别/1月/12月；数据行 [类别, 1月, ...]，与 parseCostRows 对齐。
  const costHeader = ['类别'];
  for (let m = 1; m <= 12; m += 1) costHeader.push(`${m}月`);
  const costData = ['人工成本'];
  for (let m = 1; m <= 12; m += 1) costData.push(m === 1 ? 100 : null);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([costHeader, costData]), '成本测算表');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}


function costBuf() {
  const header = ['类别'];
  const data = ['水电费'];
  for (let month = 1; month <= 12; month += 1) {
    header.push(`${month}月`);
    data.push(month === 1 ? 125 : null);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, data]), '成本测算表');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function verifyJob(token, uid, jobType, buffer, filename) {
  const form = new FormData();
  form.append('file', new Blob([buffer]), filename);
  form.append('jobType', jobType);
  form.append('reportYear', '2026');
  const created = await api('/city/import-jobs', { method: 'POST', token, form });
  if ((created.status !== 200 && created.status !== 201) || created.data?.operatorUserId !== uid) {
    throw new Error(`${jobType} 创建作业失败: ${JSON.stringify(created)}`);
  }
  const jobId = created.data.jobId;
  const prev = await api(`/city/import-jobs/${jobId}/preview`, { token });
  if (prev.status !== 200 || prev.data?.parsedSummary?.validation?.isValid !== true) {
    throw new Error(`${jobType} 预览未通过: ${JSON.stringify(prev)}`);
  }
  const conf = await api(`/city/import-jobs/${jobId}/confirm`, { method: 'POST', token, json: { confirmOverwrite: true } });
  if ((conf.status !== 200 && conf.status !== 201) || conf.data?.success !== true) {
    throw new Error(`${jobType} 确认写入失败: ${JSON.stringify(conf)}`);
  }
  const got = await api(`/city/import-jobs/${jobId}`, { token });
  if (got.status !== 200 || got.data?.status !== 'completed') {
    throw new Error(`${jobType} 最终状态错误: ${JSON.stringify(got)}`);
  }
  console.log(`${jobType}: job #${jobId}, preview valid, confirm success, status completed`);
  return jobId;
}
async function main() {
  const token = process.env.REAL_WRITE_CITY_USER_TOKEN;
  if (!token) throw new Error('必须通过 REAL_WRITE_CITY_USER_TOKEN 提供 root_admin 预建的隔离 city_user 令牌');
  const me = await api('/me', { token });
  if (me.status !== 200 || me.data?.role !== 'city_user') throw new Error('REAL_WRITE_CITY_USER_TOKEN 不是有效 city_user 会话');
  const uid = me.data.id;
  console.log('user #' + uid);
  const reportJobId = await verifyJob(token, uid, 'city_reporting', reportBuf(), 'real-report.xlsx');
  const costJobId = await verifyJob(token, uid, 'city_cost', costBuf(), 'real-cost.xlsx');
  console.log(`\n结果: 双链真实写入闭环成功 (report=${reportJobId}, cost=${costJobId})`);
}
main().catch((e) => { console.error(e); process.exitCode = 2; });
