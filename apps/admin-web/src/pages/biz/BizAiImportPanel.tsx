import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Modal, Select, Space, Table, Tag, Typography, Upload, message } from 'antd';
import { DownloadOutlined, InboxOutlined } from '@ant-design/icons';
import * as aiApi from '@/api/ai.api';

const { Text } = Typography;

/**
 * 批量导入面板（AI 助手的统一导入入口）
 *
 * 这里只做三件事：选类型、传文件、把结果说清楚。
 * 真正的解析与落库在各自模块的接口里完成 —— 合同/订单/绩效是「提交即完成」，
 * 后评估与维护三类是「先预检再确认」。两种交互由后端清单的 mode 决定，前端不做猜测。
 */

interface Props {
  open: boolean;
  onClose: () => void;
  /** 导入成功后回调：父组件可刷新功能清单等 */
  onImported?: () => void;
}

export default function BizAiImportPanel({ open, onClose, onImported }: Props) {
  const [types, setTypes] = useState<aiApi.AiImportType[]>([]);
  const [typeKey, setTypeKey] = useState<string | undefined>(undefined);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<aiApi.AiImportPreviewShape | null>(null);
  const [result, setResult] = useState<aiApi.AiImportPreviewShape | null>(null);
  const [rawResult, setRawResult] = useState<Record<string, unknown> | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void aiApi.aiImportTypes()
      .then((data) => {
        setTypes(data.items);
        setTypeKey((prev) => prev ?? data.items[0]?.key);
        if (data.items.length === 0) setErrorText('当前账号未开通批量导入权限，请联系管理员');
      })
      .catch(() => setErrorText('导入类型加载失败，请稍后重试'));
  }, [open]);

  const active = useMemo(() => types.find((item) => item.key === typeKey), [types, typeKey]);

  const resetOutcome = useCallback(() => {
    setFile(null);
    setPreview(null);
    setResult(null);
    setRawResult(null);
    setErrorText(null);
  }, []);

  useEffect(() => { resetOutcome(); }, [typeKey, resetOutcome]);

  const groupOptions = useMemo(() => {
    const grouped = new Map<string, aiApi.AiImportType[]>();
    for (const item of types) {
      const bucket = grouped.get(item.group) ?? [];
      bucket.push(item);
      grouped.set(item.group, bucket);
    }
    return [...grouped.entries()].map(([group, items]) => ({
      label: group,
      options: items.map((item) => ({ label: item.name, value: item.key })),
    }));
  }, [types]);

  const downloadTemplate = async () => {
    if (!active?.templateEndpoint) return;
    try {
      const blob = await aiApi.aiImportTemplate(active.templateEndpoint);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${active.name}导入模板.xlsx`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      message.error('模板下载失败，请稍后重试');
    }
  };

  const submit = async (phase: 'preview' | 'commit' | 'direct') => {
    if (!active || !file) return;
    setBusy(true);
    setErrorText(null);
    try {
      if (phase === 'preview' && active.previewEndpoint) {
        const data = await aiApi.aiImportUpload(active.previewEndpoint, file);
        setPreview(data as unknown as aiApi.AiImportPreviewShape);
      } else if (phase === 'direct' && active.endpoint) {
        const data = await aiApi.aiImportUpload(active.endpoint, file);
        setRawResult(data);
        setResult(null);
        message.success('导入完成');
        onImported?.();
      } else if (phase === 'commit' && active.commitEndpoint) {
        const data = await aiApi.aiImportUpload(active.commitEndpoint, file);
        setResult(data as unknown as aiApi.AiImportPreviewShape);
        message.success('导入完成');
        onImported?.();
      }
    } catch (error) {
      setErrorText(errorMessageOf(error));
    } finally {
      setBusy(false);
    }
  };

  /**
   * 「提交即写入」的类型（合同 / 订单 / 月度考核）没有预检环节，
   * 点下去就直接落库，所以这里必须再拦一道确认。
   */
  const confirmDirect = () => {
    if (!active || !file) return;
    Modal.confirm({
      title: `确认导入「${active.name}」`,
      content: (
        <div>
          <div>文件：{file.name}（{(file.size / 1024 / 1024).toFixed(2)} MB）</div>
          <div style={{ marginTop: 8, color: '#c47b20' }}>
            该类型提交后立即写入，没有预检环节，请确认文件无误。
          </div>
        </div>
      ),
      okText: '确认导入',
      cancelText: '再检查一下',
      onOk: () => submit('direct'),
    });
  };

  const canPick = Boolean(file) && !busy;

  return (
    <Modal open={open} onCancel={onClose} title="批量导入" width={760} footer={null} destroyOnHidden>
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <div>
          <Text type="secondary" style={{ fontSize: 12 }}>导入类型</Text>
          <Select
            value={typeKey}
            onChange={setTypeKey}
            style={{ width: '100%', marginTop: 4 }}
            options={groupOptions}
            placeholder="选择要导入的内容"
          />
          {active?.hint && <div style={{ marginTop: 4 }}><Text type="secondary" style={{ fontSize: 12 }}>{active.hint}</Text></div>}
        </div>

        <Space wrap>
          <Upload
            accept={active?.accept ?? '.xlsx'}
            showUploadList={false}
            beforeUpload={(picked) => {
              setFile(picked as File);
              setPreview(null);
              setResult(null);
              setRawResult(null);
              setErrorText(null);
              return false;
            }}
          >
            <Button icon={<InboxOutlined />}>选择文件</Button>
          </Upload>
          {file && <Text>{file.name}（{(file.size / 1024 / 1024).toFixed(2)} MB）</Text>}
          {active?.templateEndpoint && (
            <Button type="link" icon={<DownloadOutlined />} onClick={() => void downloadTemplate()}>下载模板</Button>
          )}
        </Space>

        <Text type="secondary" style={{ fontSize: 12 }}>
          按列名匹配：能对上数据库字段的列会导入，对不上的列整列忽略；重复数据按「编号 + 所属公司 + 所属区域」覆盖。
        </Text>

        {errorText && <Alert type="error" showIcon message={errorText} />}

        <Space>
          {active?.mode === 'direct' || !active ? (
            <Button type="primary" disabled={!canPick} loading={busy} onClick={confirmDirect}>开始导入</Button>
          ) : preview ? (
            <Button type="primary" disabled={busy} loading={busy} onClick={() => void submit('commit')}>确认导入</Button>
          ) : (
            <Button type="primary" disabled={!canPick} loading={busy} onClick={() => void submit('preview')}>预检</Button>
          )}
          {preview && <Button onClick={resetOutcome} disabled={busy}>重新选择</Button>}
        </Space>

        {preview && <OutcomeBlock data={preview} title="预检结果（尚未写入）" />}
        {result && <OutcomeBlock data={result} title="导入结果" />}
        {rawResult && (
          <div>
            <Text strong>接口返回</Text>
            <pre style={{ marginTop: 6, padding: 10, background: 'rgba(127,127,127,0.08)', borderRadius: 8, fontSize: 12, overflowX: 'auto' }}>
              {JSON.stringify(rawResult, null, 2)}
            </pre>
          </div>
        )}
      </Space>
    </Modal>
  );
}

function OutcomeBlock({ data, title }: { data: aiApi.AiImportPreviewShape; title: string }) {
  const hasStats = data.totalRows !== undefined;
  const revived = data.reviveCount ?? data.revived ?? 0;
  return (
    <div>
      <Text strong>{title}</Text>
      {hasStats && (
        <Space wrap size={8} style={{ marginTop: 8, display: 'flex' }}>
          <Tag>总行数 {data.totalRows}</Tag>
          <Tag color="blue">新增 {data.createCount ?? data.created ?? 0}</Tag>
          <Tag color="gold">覆盖 {data.updateCount ?? data.updated ?? 0}</Tag>
          {revived > 0 && <Tag color="purple">复活已删除 {revived}</Tag>}
          <Tag color={(data.errorCount ?? 0) > 0 ? 'red' : 'green'}>错误 {data.errorCount ?? 0}</Tag>
        </Space>
      )}
      {data.ignoredColumns?.length ? (
        <div style={{ marginTop: 6 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>已忽略列：{data.ignoredColumns.join('、')}</Text>
        </div>
      ) : null}
      {data.batchId && (
        <div style={{ marginTop: 4 }}>
          <Text type="secondary" style={{ fontSize: 12 }}>批次号：{data.batchId}（审计日志可查）</Text>
        </div>
      )}
      {data.missingRequiredColumns?.length ? (
        <Alert
          style={{ marginTop: 8 }}
          type="warning"
          showIcon
          message={`缺少必填列：${data.missingRequiredColumns.join('、')}`}
        />
      ) : null}
      {data.issues?.length ? (
        <Table
          size="small"
          style={{ marginTop: 8 }}
          rowKey={(row) => `i-${row.rowNo}`}
          pagination={{ pageSize: 6, size: 'small', showSizeChanger: false }}
          dataSource={data.issues}
          columns={[
            { title: '行号', dataIndex: 'rowNo', width: 80 },
            { title: '原因', dataIndex: 'message' },
          ]}
        />
      ) : null}
    </div>
  );
}

function errorMessageOf(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: { message?: string | string[] } } }).response;
  const detail = response?.data?.message;
  if (Array.isArray(detail)) return detail.join('；');
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (response?.status === 403) return '当前账号没有该操作的权限';
  if (response?.status === 413) return '文件太大，请拆分后重试';
  if (response?.status && response.status >= 500) return '服务端处理失败，请稍后重试';
  return '网络异常或文件无法解析，请检查后重试';
}
