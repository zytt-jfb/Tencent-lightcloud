import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Empty, Input, Space, Spin, Table, Tag, Typography, message } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { BulbOutlined, DislikeOutlined, LikeOutlined, ReloadOutlined } from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import * as aiApi from '@/api/ai.api';

const { Title, Text, Paragraph } = Typography;

/**
 * 智能助手页（内部专用）
 *
 * 这个页面刻意做得很「薄」：所有判断都在后端。
 *   · 有没有权限、能看到哪个范围的地市 —— 后端算好，前端只渲染；
 *   · 图表 option 由后端 result → ECharts option 直接给出，前端不二次加工，
 *     否则「图上数字」和「文字结论」就有两个来源，迟早对不上；
 *   · 没识别出意图时，后端返回的是「当前账号可用功能清单」，前端只负责点选。
 */
export default function BizAiAssistant() {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<aiApi.AiChatResponse | null>(null);
  const [intents, setIntents] = useState<aiApi.AiIntentItem[]>([]);
  const [feedbackDone, setFeedbackDone] = useState<Record<number, 'up' | 'down'>>({});

  useEffect(() => {
    // 功能清单只影响「快捷问题」的展示，失败不阻塞主流程
    void aiApi.aiIntents().then((data) => setIntents(data.items)).catch(() => undefined);
  }, []);

  const examples = useMemo(
    () => intents.flatMap((item) => item.examples).slice(0, 6),
    [intents],
  );

  const runQuestion = useCallback(async (text: string) => {
    const value = text.trim();
    if (!value) return;
    setLoading(true);
    try {
      setResult(await aiApi.aiChat(value));
    } catch (error) {
      // request 拦截器已经 toast 过具体错误，这里只补一个可重试的状态
      setResult(null);
      const detail = (error as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      message.error(Array.isArray(detail) ? detail.join('；') : (detail ?? '查询失败，请稍后重试'));
    } finally {
      setLoading(false);
    }
  }, []);

  const runIntent = useCallback(async (intentId: string) => {
    setLoading(true);
    try {
      setResult(await aiApi.aiReport(intentId));
    } catch (error) {
      const detail = (error as { response?: { data?: { message?: string | string[] } } }).response?.data?.message;
      message.error(Array.isArray(detail) ? detail.join('；') : (detail ?? '生成报告失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  const sendFeedback = useCallback(async (eventId: number, feedback: 'up' | 'down') => {
    try {
      await aiApi.aiFeedback(eventId, feedback);
      setFeedbackDone((prev) => ({ ...prev, [eventId]: feedback }));
      message.success('已记录，谢谢反馈');
    } catch {
      message.error('反馈失败');
    }
  }, []);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Title level={4} style={{ margin: 0 }}>智能助手</Title>
        <Text type="secondary">
          按预置规则查询业务数据，不经过大模型；能看到哪些数据由你的账号权限决定。
        </Text>
      </div>

      <Card>
        <Input.Search
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onSearch={(value) => void runQuestion(value)}
          enterButton="查询"
          loading={loading}
          allowClear
          placeholder="例如：2026-09 后评估排名 / 2026 年经营单元考核排名 / 未来 60 天到期的合同"
        />
        {examples.length > 0 && (
          <Space wrap size={8} style={{ marginTop: 12 }}>
            <Text type="secondary"><BulbOutlined /> 试试：</Text>
            {examples.map((example) => (
              <Tag
                key={example}
                style={{ cursor: 'pointer' }}
                onClick={() => { setQuestion(example); void runQuestion(example); }}
              >
                {example}
              </Tag>
            ))}
          </Space>
        )}
      </Card>

      <Spin spinning={loading}>
        {result ? (
          <ResultCard
            data={result}
            feedbackDone={feedbackDone}
            onRunIntent={(intentId) => void runIntent(intentId)}
            onFeedback={(eventId, feedback) => void sendFeedback(eventId, feedback)}
            onRetry={() => void runQuestion(question)}
          />
        ) : (
          <Card>
            <Empty
              description={loading ? '正在查询…' : '输入问题或点示例开始'}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          </Card>
        )}
      </Spin>
    </Space>
  );
}

interface ResultCardProps {
  data: aiApi.AiChatResponse;
  feedbackDone: Record<number, 'up' | 'down'>;
  onRunIntent: (intentId: string) => void;
  onFeedback: (eventId: number, feedback: 'up' | 'down') => void;
  onRetry: () => void;
}

function ResultCard({ data, feedbackDone, onRunIntent, onFeedback, onRetry }: ResultCardProps) {
  const { meta } = data;

  return (
    <Card
      title={data.intentName ?? (data.type === 'guide' ? '未识别到功能' : '查询结果')}
      extra={
        <Space size={8}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {meta.rowCount} 行 · {meta.latencyMs}ms · 范围：{meta.scopeLabel}
          </Text>
          <Button size="small" icon={<ReloadOutlined />} onClick={onRetry}>重试</Button>
        </Space>
      }
    >
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Paragraph style={{ margin: 0 }}>{data.summary}</Paragraph>

        {data.type === 'ask_param' && data.missing && (
          <Alert
            type="warning"
            showIcon
            message={`需要补充参数：${data.missing.map((item) => item.label).join('、')}`}
          />
        )}

        {data.type === 'guide' && data.guide && (
          <Space wrap size={8}>
            {data.guide.map((item) => (
              <Button key={item.id} size="small" onClick={() => onRunIntent(item.id)}>
                {item.name}
              </Button>
            ))}
          </Space>
        )}

        {data.chart && (
          <div style={{ height: 320 }}>
            <ReactECharts
              option={data.chart as unknown as EChartsOption}
              style={{ height: '100%', width: '100%' }}
              notMerge
            />
          </div>
        )}

        {data.type === 'answer' && data.rows && data.rows.length > 0 && (
          <Table<Record<string, unknown>>
            size="small"
            rowKey={(_row, index) => String(index)}
            columns={buildColumns(data.columns ?? [])}
            dataSource={data.rows}
            pagination={{ pageSize: 10, size: 'small', showSizeChanger: false }}
            scroll={{ x: 'max-content' }}
          />
        )}

        {meta.truncated && (
          <Alert
            type="info"
            showIcon
            message="结果已达到单次返回上限，只展示前若干行；如需完整数据请缩小范围（例如指定月份或地市）。"
          />
        )}

        {data.type === 'knowledge' && data.chunks && (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            {data.chunks.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="知识库暂无相关片段" />}
            {data.chunks.map((chunk, index) => (
              <Card key={`${chunk.sourcePath}-${index}`} size="small" type="inner"
                title={<Text style={{ fontSize: 13 }}>{chunk.title ?? chunk.sourcePath}{chunk.section ? ` · ${chunk.section}` : ''}</Text>}
              >
                <Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{chunk.excerpt}</Paragraph>
              </Card>
            ))}
          </Space>
        )}

        {meta.eventId !== null && (
          <Space size={8}>
            <Text type="secondary" style={{ fontSize: 12 }}>这条结果有用吗？</Text>
            <Button
              size="small"
              type={feedbackDone[meta.eventId] === 'up' ? 'primary' : 'default'}
              icon={<LikeOutlined />}
              disabled={Boolean(feedbackDone[meta.eventId])}
              onClick={() => onFeedback(meta.eventId as number, 'up')}
            >
              有用
            </Button>
            <Button
              size="small"
              danger={feedbackDone[meta.eventId] === 'down'}
              icon={<DislikeOutlined />}
              disabled={Boolean(feedbackDone[meta.eventId])}
              onClick={() => onFeedback(meta.eventId as number, 'down')}
            >
              不准
            </Button>
          </Space>
        )}

        <Text type="secondary" style={{ fontSize: 11 }}>trace: {meta.traceId}</Text>
      </Space>
    </Card>
  );
}

function buildColumns(spec: aiApi.AiColumn[]): ColumnsType<Record<string, unknown>> {
  return spec.map((column) => ({
    title: column.label,
    dataIndex: column.key,
    key: column.key,
    align: column.kind === 'number' || column.kind === 'money' ? 'right' : 'left',
    render: (_value: unknown, row: Record<string, unknown>) => formatCell(row[column.key], column.kind),
  }));
}

function formatCell(value: unknown, kind?: aiApi.AiColumn['kind']): string {
  if (value === null || value === undefined || value === '') return '—';
  if (kind === 'money' && typeof value === 'number') {
    return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (kind === 'number' && typeof value === 'number') {
    return value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
  }
  return String(value);
}
