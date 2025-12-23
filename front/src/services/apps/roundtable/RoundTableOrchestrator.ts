/**
 * RoundTableOrchestrator - 圆桌会议编排器
 * 管理多 Agent 的讨论会议
 */

import { Agent, Session } from '../../session';
import { TurnManager, type TurnConfig, type TurnStrategy } from './TurnManager';
import { createLogger, generateId } from '../../core/shared/utils';

const logger = createLogger('RoundTableOrchestrator');

/**
 * 会议配置
 */
export interface RoundTableConfig {
  name: string;
  topic: string;
  maxRounds: number;
  turnConfig?: Partial<TurnConfig>;
  moderatorId?: string;         // 主持人 Agent ID
  summarizeAfterRound: boolean;
}

/**
 * 默认会议配置
 */
export const DEFAULT_ROUNDTABLE_CONFIG: Partial<RoundTableConfig> = {
  maxRounds: 5,
  summarizeAfterRound: true,
};

/**
 * 会议状态
 */
export type RoundTableStatus = 'preparing' | 'in_progress' | 'paused' | 'ended';

/**
 * 会议记录
 */
export interface RoundTableRecord {
  id: string;
  config: RoundTableConfig;
  status: RoundTableStatus;
  currentRound: number;
  transcript: TranscriptEntry[];
  roundSummaries: string[];
  startedAt?: number;
  endedAt?: number;
}

/**
 * 发言记录
 */
export interface TranscriptEntry {
  round: number;
  turn: number;
  speakerId: string;
  speakerName: string;
  content: string;
  timestamp: number;
}

/**
 * 圆桌会议编排器
 */
export class RoundTableOrchestrator {
  private config: RoundTableConfig;
  private session: Session;
  private turnManager: TurnManager;
  private record: RoundTableRecord;
  private agents: Map<string, Agent> = new Map();

  constructor(config: RoundTableConfig) {
    this.config = { ...DEFAULT_ROUNDTABLE_CONFIG, ...config } as RoundTableConfig;
    this.session = new Session('roundtable', config.name, config.topic);
    this.turnManager = new TurnManager(config.turnConfig);
    
    this.record = {
      id: generateId('rt'),
      config: this.config,
      status: 'preparing',
      currentRound: 0,
      transcript: [],
      roundSummaries: [],
    };
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * 添加参与者
   */
  addParticipant(agent: Agent): void {
    if (this.record.status !== 'preparing') {
      logger.warn('Cannot add participant after meeting started');
      return;
    }

    this.agents.set(agent.id, agent);
    this.session.addAgent(agent);

    // 设置响应回调
    agent.onResponse((content, replyTo) => {
      this.handleAgentResponse(agent.id, agent.name, content, replyTo);
    });

    logger.info('Participant added', { meetingId: this.record.id, agentId: agent.id });
  }

  /**
   * 开始会议
   */
  async start(): Promise<void> {
    if (this.agents.size < 2) {
      throw new Error('At least 2 participants required');
    }

    this.record.status = 'in_progress';
    this.record.startedAt = Date.now();

    // 设置轮次管理器的参与者
    this.turnManager.setParticipants(Array.from(this.agents.values()));

    // 设置轮次回调
    this.turnManager.onTurn((agentId) => {
      this.inviteToSpeak(agentId);
    });

    logger.info('Meeting started', {
      meetingId: this.record.id,
      topic: this.config.topic,
      participants: this.agents.size,
    });

    // 开场白
    await this.sendOpeningMessage();

    // 开始第一轮
    this.startRound();
  }

  /**
   * 暂停会议
   */
  pause(): void {
    this.record.status = 'paused';
    logger.info('Meeting paused', { meetingId: this.record.id });
  }

  /**
   * 恢复会议
   */
  resume(): void {
    this.record.status = 'in_progress';
    logger.info('Meeting resumed', { meetingId: this.record.id });
  }

  /**
   * 结束会议
   */
  async end(): Promise<RoundTableRecord> {
    this.record.status = 'ended';
    this.record.endedAt = Date.now();

    // 生成最终总结
    await this.generateFinalSummary();

    this.session.end();

    logger.info('Meeting ended', {
      meetingId: this.record.id,
      duration: this.record.endedAt - (this.record.startedAt || 0),
      totalTurns: this.record.transcript.length,
    });

    return this.record;
  }

  /**
   * 获取会议记录
   */
  getRecord(): RoundTableRecord {
    return { ...this.record };
  }

  /**
   * 获取当前状态
   */
  getStatus(): RoundTableStatus {
    return this.record.status;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * 开始新一轮
   */
  private startRound(): void {
    this.record.currentRound++;
    
    if (this.record.currentRound > this.config.maxRounds) {
      this.end();
      return;
    }

    logger.info('Round started', {
      meetingId: this.record.id,
      round: this.record.currentRound,
    });

    // 开始轮次
    this.turnManager.startNewRound();
  }

  /**
   * 邀请发言
   */
  private inviteToSpeak(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    const prompt = this.generateSpeakPrompt(agent.name);
    agent.receive('moderator', 'Moderator', prompt, { priority: 'high' });
  }

  /**
   * 处理 Agent 响应
   */
  private handleAgentResponse(
    agentId: string,
    agentName: string,
    content: string,
    replyTo?: string
  ): void {
    // 记录发言
    const entry: TranscriptEntry = {
      round: this.record.currentRound,
      turn: this.record.transcript.filter((e) => e.round === this.record.currentRound).length + 1,
      speakerId: agentId,
      speakerName: agentName,
      content,
      timestamp: Date.now(),
    };
    this.record.transcript.push(entry);

    // 广播给其他参与者
    for (const [id, agent] of this.agents) {
      if (id !== agentId) {
        agent.receive(agentId, agentName, content);
      }
    }

    // 结束当前发言，进入下一个
    this.turnManager.endTurn();
    const nextSpeaker = this.turnManager.nextTurn();

    if (!nextSpeaker) {
      // 当前轮结束
      this.onRoundEnd();
    }
  }

  /**
   * 轮次结束
   */
  private async onRoundEnd(): Promise<void> {
    logger.info('Round ended', {
      meetingId: this.record.id,
      round: this.record.currentRound,
    });

    // 生成本轮总结
    if (this.config.summarizeAfterRound) {
      const summary = await this.generateRoundSummary();
      this.record.roundSummaries.push(summary);
    }

    // 检查是否继续
    if (this.record.currentRound < this.config.maxRounds) {
      this.startRound();
    } else {
      this.end();
    }
  }

  /**
   * 发送开场白
   */
  private async sendOpeningMessage(): Promise<void> {
    const message = `欢迎参加本次圆桌会议！\n\n主题：${this.config.topic}\n\n请各位参与者依次发表观点。`;
    
    for (const agent of this.agents.values()) {
      agent.receive('moderator', 'Moderator', message);
    }
  }

  /**
   * 生成发言提示
   */
  private generateSpeakPrompt(agentName: string): string {
    const recentEntries = this.record.transcript.slice(-3);
    let context = '';
    
    if (recentEntries.length > 0) {
      context = '\n\n最近的发言：\n' + recentEntries
        .map((e) => `${e.speakerName}: ${e.content}`)
        .join('\n');
    }

    return `${agentName}，轮到您发言了。\n\n讨论主题：${this.config.topic}${context}\n\n请分享您的观点或回应其他参与者。`;
  }

  /**
   * 生成本轮总结
   */
  private async generateRoundSummary(): Promise<string> {
    const roundEntries = this.record.transcript.filter(
      (e) => e.round === this.record.currentRound
    );

    // 简单汇总
    const points = roundEntries.map((e) => `- ${e.speakerName}: ${e.content.slice(0, 100)}...`);
    return `第${this.record.currentRound}轮总结：\n${points.join('\n')}`;
  }

  /**
   * 生成最终总结
   */
  private async generateFinalSummary(): Promise<void> {
    // 可以使用 LLM 生成更好的总结
    const summary = `会议总结：\n主题：${this.config.topic}\n总轮次：${this.record.currentRound}\n总发言：${this.record.transcript.length}`;
    this.record.roundSummaries.push(summary);
  }
}
