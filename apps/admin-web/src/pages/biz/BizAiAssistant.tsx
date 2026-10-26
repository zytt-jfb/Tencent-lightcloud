import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Space, Table, Tooltip, message as antdMessage } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  ClearOutlined, DislikeOutlined, LikeOutlined, RobotOutlined, SendOutlined, UploadOutlined,
} from '@ant-design/icons';
import ReactECharts from 'echarts-for-react';
import type { EChartsOption } from 'echarts';
import * as aiApi from '@/api/ai.api';
import BizAiImportPanel from './BizAiImportPanel';
import './BizAiAssistant.css';

/**
 * 智能助手（聊天流版）
 *
 * 设计取向（与 WorkBuddy 一致的体验，但守住「零幻觉」）：
 *   · 发送即入列：用户消息和助手占位立刻出现，不等接口返回，避免点了没反应；
 *   · 助手气泡里直接给「结论 + 图 + 可折叠明细」，不做二次跳转；
 *   · 五种结果都有对应形态：正常结果 / 未识别（功能清单）/ 缺参数 / 知识库片段 / 错误；
 *   · 失败不清空历史，只在当前消息内提示并可重试。
 *
 * 明确不做：多轮上下文（每问独立查询）、会话持久化（刷新清空）、深色主题。
 * 这三条是需求评审时定下的，不是遗漏 —— 要做需要先改后端契约。
 */

type MsgStatus = 'loading' | 'done' | 'error';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  /** 用户输入内容 */
  text?: string;
  /** 助手结果 */
  data?: aiApi.AiChatResponse;
  status: MsgStatus;
  errorText?: string;
  /** 重试用的原始输入（提问）或意图 id（点选功能清单） */
  retryQuestion?: string;
  retryIntent?: string;
}

const SUGGESTION_LIMIT = 6;

/**
 * 图表配色（只影响观感，不动数据）。
 * 后端只给 option 结构与数值，颜色交给前端统一成整站主色；
 * 若后端将来自己声明了 color，则后端的优先（展开顺序决定）。
 */
const CHART_PALETTE = ['#0071e3', '#4e9bd6', '#e0a32e', '#dd6b4d', '#8d98b3', '#7a68b8'];

export default function BizAiAssistant() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [intents, setIntents] = useState<aiApi.AiIntentItem[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [feedbackDone, setFeedbackDone] = useState<Record<number, 'up' | 'down'>>({});
  const [atBottom, setAtBottom] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  /** 有「批量导入」权限时后端才会返回非空清单；为空则整个入口不显示 */
  const [importTypeCount, setImportTypeCount] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    // 功能清单只用于空态推荐，失败不阻塞提问
    void aiApi.aiIntents().then((data) => setIntents(data.items)).catch(() => undefined);
    // 导入类型用于决定是否显示「批量导入」入口，失败按无权限处理
    void aiApi.aiImportTypes().then((data) => setImportTypeCount(data.items.length)).catch(() => undefined);
  }, []);

  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const item of intents) {
      for (const example of item.examples) {
        if (seen.has(example)) continue;
        seen.add(example);
        list.push(example);
        if (list.length >= SUGGESTION_LIMIT) return list;
      }
    }
    return list;
  }, [intents]);

  // 只有「本来就在底部」时才跟随滚动；用户翻看历史时不强行拉回
  useEffect(() => {
    if (!atBottom) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, atBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
  }, []);

  const runChat = useCallback(async (question: string) => {
    const text = question.trim();
    if (!text) return;
    seq.current += 1;
    const userId = `u-${seq.current}`;
    const assistantId = `a-${seq.current}`;
    setSending(true);
    setAtBottom(true);
    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', text, status: 'done' },
      { id: assistantId, role: 'assistant', status: 'loading', retryQuestion: text },
    ]);

    try {
      const data = await aiApi.aiChat(text);
      setMessages((prev) => prev.map((item) => (item.id === assistantId ? { ...item, status: 'done', data } : item)));
    } catch (error) {
      setMessages((prev) => prev.map((item) => (
        item.id === assistantId ? { ...item, status: 'error', errorText: errorTextOf(error) } : item
      )));
    } finally {
      setSending(false);
    }
  }, []);

  const runIntent = useCallback(async (intentId: string) => {
    seq.current += 1;
    const assistantId = `a-${seq.current}`;
    const userId = `u-${seq.current}`;
    const label = intents.find((item) => item.id === intentId)?.name ?? '查询';
    setSending(true);
    setAtBottom(true);
    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', text: label, status: 'done' },
      { id: assistantId, role: 'assistant', status: 'loading', retryIntent: intentId },
    ]);

    try {
      const data = await aiApi.aiReport(intentId);
      setMessages((prev) => prev.map((item) => (item.id === assistantId ? { ...item, status: 'done', data } : item)));
    } catch (error) {
      setMessages((prev) => prev.map((item) => (
        item.id === assistantId ? { ...item, status: 'error', errorText: errorTextOf(error) } : item
      )));
    } finally {
      setSending(false);
    }
  }, [intents]);

  const sendFeedback = useCallback(async (eventId: number, feedback: 'up' | 'down') => {
    try {
      await aiApi.aiFeedback(eventId, feedback);
      setFeedbackDone((prev) => ({ ...prev, [eventId]: feedback }));
      antdMessage.success('已记录，谢谢反馈');
    } catch {
      antdMessage.error('反馈失败，请稍后再试');
    }
  }, []);

  const submit = useCallback(() => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    void runChat(text);
  }, [input, sending, runChat]);

  const clearAll = useCallback(() => {
    setMessages([]);
    setExpanded({});
    setFeedbackDone({});
    setInput('');
  }, []);

  const toggleDetail = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  return (
    <div className="ai-chat">
      <div className="ai-chat__head">
        <div className="ai-chat__title">
          <strong>智能助手</strong>
          <span>按预置规则查数，不经过大模型；可见范围由账号权限决定</span>
        </div>
        <Space size={8}>
          {importTypeCount > 0 && (
            <Button size="small" icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>批量导入</Button>
          )}
          {messages.length > 0 && (
            <Button size="small" icon={<ClearOutlined />} onClick={clearAll}>清空对话</Button>
          )}
        </Space>
      </div>

      <div className="ai-chat__scroll" ref={scrollRef} onScroll={handleScroll}>
        {messages.length === 0 ? (
          <div className="ai-chat__stream">
            <EmptyState suggestions={suggestions} onPick={(text) => void runChat(text)} />
          </div>
        ) : (
          <div className="ai-chat__stream">
            {messages.map((item) => (
              <MessageRow
                key={item.id}
                msg={item}
                expanded={Boolean(expanded[item.id])}
                feedbackDone={feedbackDone}
                onToggleDetail={() => toggleDetail(item.id)}
                onRunIntent={(intentId) => void runIntent(intentId)}
                onFeedback={(eventId, feedback) => void sendFeedback(eventId, feedback)}
                onRetry={() => {
                  if (item.retryQuestion) void runChat(item.retryQuestion);
                  else if (item.retryIntent) void runIntent(item.retryIntent);
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div className="ai-chat__composer">
        <div className="ai-chat__composer-inner">
          <Input.TextArea
            className="ai-chat__input"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="问一句业务问题，例如：2026-09 后评估排名"
            autoSize={{ minRows: 1, maxRows: 5 }}
            maxLength={500}
            onKeyDown={(event) => {
              // 中文输入法组合期间的 Enter 是在选词，不能当发送
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <Tooltip title="发送（Enter）">
            <Button
              type="primary"
              shape="circle"
              size="large"
              icon={<SendOutlined />}
              loading={sending}
              disabled={!input.trim()}
              onClick={submit}
            />
          </Tooltip>
        </div>
        <div className="ai-chat__hint">Enter 发送 · Shift + Enter 换行 · 刷新后对话清空</div>
      </div>

      <BizAiImportPanel open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}

/* ==========================================================================
   消息行
   ========================================================================== */

interface MessageRowProps {
  msg: ChatMessage;
  expanded: boolean;
  feedbackDone: Record<number, 'up' | 'down'>;
  onToggleDetail: () => void;
  onRunIntent: (intentId: string) => void;
  onFeedback: (eventId: number, feedback: 'up' | 'down') => void;
  onRetry: () => void;
}

function MessageRow({ msg, expanded, feedbackDone, onToggleDetail, onRunIntent, onFeedback, onRetry }: MessageRowProps) {
  if (msg.role === 'user') {
    return (
      <div className="ai-msg ai-msg--user">
        <div className="ai-msg__bubble-user">{msg.text}</div>
      </div>
    );
  }

  return (
    <div className="ai-msg ai-msg--assistant">
      <div className="ai-msg__avatar"><RobotOutlined /></div>
      <div className="ai-msg__body">
        {msg.status === 'loading' && (
          <span className="ai-dots" aria-label="正在查询"><i /><i /><i /></span>
        )}

        {msg.status === 'error' && (
          <div className="ai-chat__error">
            <span>{msg.errorText ?? '查询失败'}</span>
            <Button size="small" onClick={onRetry}>重试</Button>
          </div>
        )}

        {msg.status === 'done' && msg.data && (
          <AssistantBody
            data={msg.data}
            expanded={expanded}
            feedbackDone={feedbackDone}
            onToggleDetail={onToggleDetail}
            onRunIntent={onRunIntent}
            onFeedback={onFeedback}
          />
        )}
      </div>
    </div>
  );
}

/* ==========================================================================
   助手结果体
   ========================================================================== */

interface AssistantBodyProps {
  data: aiApi.AiChatResponse;
  expanded: boolean;
  feedbackDone: Record<number, 'up' | 'down'>;
  onToggleDetail: () => void;
  onRunIntent: (intentId: string) => void;
  onFeedback: (eventId: number, feedback: 'up' | 'down') => void;
}

function AssistantBody({ data, expanded, feedbackDone, onToggleDetail, onRunIntent, onFeedback }: AssistantBodyProps) {
  const { meta } = data;
  const rows = data.rows ?? [];
  const columns = data.columns ?? [];

  return (
    <>
      <div className="ai-msg__summary">{data.summary}</div>

      {data.type === 'guide' && data.guide && data.guide.length > 0 && (
        <div className="ai-chat__guide">
          {data.guide.map((item) => (
            <Button key={item.id} size="small" onClick={() => onRunIntent(item.id)}>{item.name}</Button>
          ))}
        </div>
      )}

      {data.chart && (
        <div className="ai-chat__chart">
          <ReactECharts
            option={{ color: CHART_PALETTE, ...(data.chart as Record<string, unknown>) } as unknown as EChartsOption}
            style={{ height: '100%', width: '100%' }}
            notMerge
          />
        </div>
      )}

      {rows.length > 0 && columns.length > 0 && (
        <>
          <button type="button" className="ai-chat__toggle" onClick={onToggleDetail}>
            {expanded ? '收起明细' : `查看 ${rows.length} 行明细`}
          </button>
          {expanded && (
            <div className="ai-chat__table">
              <Table<Record<string, unknown>>
                size="small"
                rowKey={(_row, index) => String(index)}
                columns={buildColumns(columns)}
                dataSource={rows}
                pagination={{ pageSize: 5, size: 'small', showSizeChanger: false }}
                scroll={{ x: 'max-content' }}
              />
            </div>
          )}
        </>
      )}

      {data.type === 'knowledge' && data.chunks && data.chunks.length > 0 && (
        <>
          {data.chunks.map((chunk, index) => (
            <div className="ai-chat__fragment" key={`${chunk.sourcePath}-${index}`}>
              <div className="ai-chat__fragment-head">
                {chunk.title ?? chunk.sourcePath}
                {chunk.section ? ` · ${chunk.section}` : ''}
              </div>
              <div className="ai-chat__fragment-body">{chunk.excerpt}</div>
            </div>
          ))}
        </>
      )}

      <div className="ai-chat__meta">
        <div className="ai-chat__meta-left">
          <span>{meta.rowCount} 行</span>
          <span>·</span>
          <span>{meta.latencyMs}ms</span>
          <span>·</span>
          <span>范围：{meta.scopeLabel}</span>
          {meta.truncated && <span style={{ color: '#c47b20' }}>· 已截断，请缩小范围</span>}
        </div>
        {meta.eventId !== null && (
          <div className="ai-chat__meta-left">
            <Button
              size="small"
              type="text"
              icon={<LikeOutlined />}
              disabled={Boolean(feedbackDone[meta.eventId])}
              onClick={() => onFeedback(meta.eventId as number, 'up')}
            >
              有用
            </Button>
            <Button
              size="small"
              type="text"
              icon={<DislikeOutlined />}
              disabled={Boolean(feedbackDone[meta.eventId])}
              onClick={() => onFeedback(meta.eventId as number, 'down')}
            >
              不准
            </Button>
          </div>
        )}
      </div>
    </>
  );
}

/* ==========================================================================
   空态
   ========================================================================== */

function EmptyState({ suggestions, onPick }: { suggestions: string[]; onPick: (text: string) => void }) {
  return (
    <div className="ai-chat__empty">
      <div className="ai-chat__empty-icon"><RobotOutlined /></div>
      <h3>有什么想查的？</h3>
      <p>
        用自然语言问业务数据，我会按预置规则查询并给出图表与结论。
        目前支持后评估、月度考核、成本、合同到期与制度问答。
      </p>
      {suggestions.length > 0 && (
        <div className="ai-chat__chips">
          {suggestions.map((text) => (
            <button key={text} type="button" className="ai-chat__chip" onClick={() => onPick(text)}>
              {text}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   工具函数
   ========================================================================== */

function buildColumns(spec: aiApi.AiColumn[]): ColumnsType<Record<string, unknown>> {
  return spec.map((column, index) => ({
    title: column.label,
    dataIndex: column.key,
    key: column.key,
    // 只有最后一列留空 width，让它吃掉剩余空间；
    // 否则 antd 会把多出来的宽度均摊到每一列，数值列会被拉得很散。
    width: index === spec.length - 1
      ? undefined
      : (column.kind === 'money' ? 160 : column.kind === 'number' ? 100 : 200),
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

/** 把 axios/后端错误压成一句人话；request 拦截器已经 toast 过一次，这里只用于气泡内展示 */
function errorTextOf(error: unknown): string {
  const response = (error as { response?: { status?: number; data?: { message?: string | string[] } } }).response;
  const detail = response?.data?.message;
  if (Array.isArray(detail)) return detail.join('；');
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (response?.status === 503) return 'AI 只读数据源未配置，请联系管理员';
  if (response?.status === 403) return '当前账号没有该功能的权限';
  if (response?.status === 429) return '查询有点频繁，请几秒后重试';
  if (response?.status && response.status >= 500) return '服务端处理失败，请重试或联系管理员';
  return '网络异常，请检查连接后重试';
}
