import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Descriptions, Empty, Popconfirm, Space, Spin, Table, Tag, Typography, Upload, message } from 'antd';
import { DownloadOutlined, InboxOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons';
import { writeWorkbook } from '@/utils/page-export-core';
import {
  assessmentBatchDelete, assessmentBatches, assessmentImportCommit, assessmentImportPreview,
  type AssessmentBatch, type AssessmentPreview,
} from '@/api/biz-assessment.api';

const { Title, Text } = Typography;

/** 导入模板表头，与后端列名别名一致（按表头名匹配，列序可变） */
const TEMPLATE_HEADERS = ['序号', '采购项目名称', '省分', '地市', '供应商', '分数', '后评价月份', '后评价方式'];

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  parsed: { label: '已解析', color: 'processing' },
  imported: { label: '已入库', color: 'success' },
  failed: { label: '失败', color: 'error' },
};

function formatMonth(value: string | null | undefined): string {
  const matched = /^(\d{4})-(\d{2})$/.exec(String(value ?? ''));
  return matched ? `${matched[1]}年${matched[2]}月` : (value ?? '-');
}

/**
 * 后评估数据导入（工程管理 / 后评估管理）
 * 流程：选择文件 → 解析预览（不落库）→ 确认导入（按 项目+地市+供应商+月份 覆盖）
 * 预览和导入各上传一次同一文件：不在服务端做临时文件存储，避免多一份敏感数据落盘。
 */
export default function AssessmentImport() {
  const [batches, setBatches] = useState<AssessmentBatch[]>([]);
  const [batchLoading, setBatchLoading] = useState(false);
  const [preview, setPreview] = useState<AssessmentPreview | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);

  const loadBatches = useCallback(async () => {
    setBatchLoading(true);
    try {
      const result = await assessmentBatches();
      setBatches(result.items);
    } catch {
      message.error('导入批次加载失败');
    } finally {
      setBatchLoading(false);
    }
  }, []);

  useEffect(() => { void loadBatches(); }, [loadBatches]);

  const handlePreview = async (file: File) => {
    setParsing(true);
    setPreview(null);
    setPendingFile(null);
    try {
      const result = await assessmentImportPreview(file);
      setPreview(result);
      setPendingFile(file);
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      message.error(Array.isArray(detail) ? detail.join('；') : (detail ?? '文件解析失败'));
    } finally {
      setParsing(false);
    }
  };

  const handleCommit = async () => {
    if (!pendingFile) return;
    setImporting(true);
    try {
      const result = await assessmentImportCommit(pendingFile);
      message.success(`导入完成：新增 ${result.insertedRows} 行，覆盖 ${result.updatedRows} 行，同批次重复合并 ${result.duplicateRows} 行`);
      setPreview(null);
      setPendingFile(null);
      await loadBatches();
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      message.error(Array.isArray(detail) ? detail.join('；') : (detail ?? '导入失败'));
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const result = await assessmentBatchDelete(id);
      message.success(`已删除该批次及 ${result.deletedRecords} 行导入数据`);
      await loadBatches();
    } catch (error: unknown) {
      const detail = (error as { response?: { data?: { message?: string } } }).response?.data?.message;
      message.error(detail ?? '删除失败');
    }
  };

  const downloadTemplate = () => {
    writeWorkbook('后评估导入模板.xlsx', [{
      name: '后评价明细',
      rows: [
        TEMPLATE_HEADERS,
        [1, '中国铁塔股份有限公司烟台市分公司2024年-2026年拓展业务维护服务项目', '山东省分公司', '烟台市分公司', '中屹技术有限公司', 96, '2026-03', '线下'],
      ],
    }]);
  };

  const batchColumns = [
    { title: '文件名', dataIndex: 'filename', key: 'filename', ellipsis: true, width: 260 },
    { title: '批次月份', dataIndex: 'evalMonth', key: 'evalMonth', width: 110, render: (value: string | null) => value ? formatMonth(value) : '跨月' },
    { title: '数据行', dataIndex: 'totalRows', key: 'totalRows', width: 80, align: 'right' as const },
    { title: '新增', dataIndex: 'insertedRows', key: 'insertedRows', width: 70, align: 'right' as const },
    { title: '替换旧行', dataIndex: 'updatedRows', key: 'updatedRows', width: 90, align: 'right' as const },
    { title: '重复合并', dataIndex: 'duplicateRows', key: 'duplicateRows', width: 90, align: 'right' as const },
    { title: '失败', dataIndex: 'failedRows', key: 'failedRows', width: 70, align: 'right' as const, render: (value: number) => value > 0 ? <Text type="danger">{value}</Text> : 0 },
    {
      title: '状态', dataIndex: 'status', key: 'status', width: 90,
      render: (value: string) => { const item = STATUS_LABEL[value] ?? { label: value, color: 'default' }; return <Tag color={item.color}>{item.label}</Tag>; },
    },
    { title: '上传时间', dataIndex: 'uploadedAt', key: 'uploadedAt', width: 170, render: (value: string) => value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-' },
    {
      title: '操作', key: 'action', width: 100, fixed: 'right' as const,
      render: (_: unknown, row: AssessmentBatch) => (
        <Popconfirm
          title="删除该批次"
          description="会同时删除该批次导入的所有明细行，线下填报记录不受影响。"
          okText="删除" cancelText="取消" okButtonProps={{ danger: true }}
          onConfirm={() => void handleDelete(row.id)}
        >
          <Button size="small" danger>删除</Button>
        </Popconfirm>
      ),
    },
  ];

  const issueColumns = [
    { title: '行号', dataIndex: 'rowNo', key: 'rowNo', width: 80 },
    { title: '原因', dataIndex: 'message', key: 'message' },
  ];

  const sampleColumns = [
    { title: '行号', dataIndex: 'rowNo', key: 'rowNo', width: 70 },
    { title: '月份', dataIndex: 'evalMonth', key: 'evalMonth', width: 100, render: (value: string) => formatMonth(value) },
    { title: '采购项目名称', dataIndex: 'projectName', key: 'projectName', ellipsis: true },
    { title: '地市', dataIndex: 'cityName', key: 'cityName', width: 120, render: (value: string) => value || '未匹配' },
    { title: '供应商', dataIndex: 'supplierName', key: 'supplierName', width: 180, ellipsis: true },
    { title: '分数', dataIndex: 'score', key: 'score', width: 80, align: 'right' as const, render: (value: number) => Number(value).toFixed(2) },
    { title: '方式', dataIndex: 'evalMethod', key: 'evalMethod', width: 70, render: (value: string) => value === 'offline' ? '线下' : '线上' },
  ];

  const validRows = preview ? preview.totalRows - preview.failedRows - preview.duplicateRows : 0;

  return (
    <div className="v3-content">
      <div className="v3-page-head">
        <div className="v3-page-titles">
          <Title level={4} style={{ margin: 0 }}>后评估数据导入</Title>
          <Text type="secondary">支持 .xlsx / .xls，按表头名匹配列；同一「项目 + 地市 + 供应商 + 月份」重复导入会覆盖原值</Text>
        </div>
        <Space className="v3-page-head-actions" wrap>
          <Button icon={<DownloadOutlined />} onClick={downloadTemplate}>下载模板</Button>
          <Button icon={<ReloadOutlined />} onClick={() => void loadBatches()}>刷新批次</Button>
        </Space>
      </div>

      <Card size="small" style={{ marginBottom: 12 }}>
        <Upload.Dragger
          accept=".xlsx,.xls"
          maxCount={1}
          showUploadList={false}
          beforeUpload={(file) => { void handlePreview(file as File); return false; }}
          disabled={parsing || importing}
        >
          <p className="ant-upload-drag-icon">{parsing ? <Spin /> : <InboxOutlined />}</p>
          <p className="ant-upload-text">{parsing ? '正在解析文件…' : '点击或拖拽 Excel 文件到此处'}</p>
          <p className="ant-upload-hint">先解析预览，确认无误后再入库；文件最大 2MB</p>
        </Upload.Dragger>
      </Card>

      {preview && (
        <Card
          size="small"
          style={{ marginBottom: 12 }}
          title={`解析结果：${preview.filename}`}
          extra={
            <Space>
              <Button onClick={() => { setPreview(null); setPendingFile(null); }}>取消</Button>
              <Button type="primary" icon={<UploadOutlined />} loading={importing} disabled={validRows === 0} onClick={() => void handleCommit()}>
                确认导入（{validRows} 行）
              </Button>
            </Space>
          }
        >
          <Descriptions size="small" column={4} bordered style={{ marginBottom: 12 }}>
            <Descriptions.Item label="工作表">
              <Text strong>{preview.sheetName}</Text>
              {preview.sheets && preview.sheets.length > 1 ? <Text type="secondary">（自动识别，共 {preview.sheets.length} 个工作表）</Text> : null}
            </Descriptions.Item>
            <Descriptions.Item label="数据行">{preview.totalRows}</Descriptions.Item>
            <Descriptions.Item label="可入库"><Text strong>{validRows}</Text></Descriptions.Item>
            <Descriptions.Item label="重复合并">{preview.duplicateRows}</Descriptions.Item>
            <Descriptions.Item label="失败行">{preview.failedRows > 0 ? <Text type="danger">{preview.failedRows}</Text> : 0}</Descriptions.Item>
            <Descriptions.Item label="月份">{preview.months.length ? preview.months.map(formatMonth).join('、') : '-'}</Descriptions.Item>
            <Descriptions.Item label="供应商数">{preview.supplierCount}</Descriptions.Item>
            <Descriptions.Item label="线上 / 线下">{preview.methodCount.online} / {preview.methodCount.offline}</Descriptions.Item>
          </Descriptions>

          {preview.unmatchedCities.length > 0 && (
            <Alert
              type="warning" showIcon style={{ marginBottom: 12 }}
              message="以下地市未匹配到城市字典，将按原文保留（不影响入库，但按地市筛选时无法归组）"
              description={preview.unmatchedCities.join('、')}
            />
          )}
          {preview.failedRows > 0 && (
            <Alert
              type="error" showIcon style={{ marginBottom: 12 }}
              message={`有 ${preview.failedRows} 行未通过校验，导入时会跳过`}
              description={<Table size="small" rowKey="rowNo" columns={issueColumns} dataSource={preview.issues} pagination={false} scroll={{ y: 200 }} />}
            />
          )}

          <Text strong>前 10 行预览</Text>
          <Table size="small" rowKey="rowNo" style={{ marginTop: 8 }} columns={sampleColumns} dataSource={preview.sample} pagination={false} scroll={{ x: 'max-content' }} />
        </Card>
      )}

      <Card size="small" title="导入批次（最近 100 次）">
        {batches.length === 0 && !batchLoading ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有导入记录" />
        ) : (
          <Table
            rowKey="id" size="small" loading={batchLoading}
            columns={batchColumns} dataSource={batches}
            scroll={{ x: 'max-content' }}
            pagination={{ pageSize: 10, showSizeChanger: false }}
          />
        )}
      </Card>
    </div>
  );
}
