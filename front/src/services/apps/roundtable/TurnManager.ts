/**
 * TurnManager - 发言轮次管理
 * 管理多 Agent 会议中的发言顺序
 */

import type { Agent } from '../../session';
import { createLogger } from '../../core/shared/utils';

const logger = createLogger('TurnManager');

/**
 * 轮次策略
 */
export type TurnStrategy = 'round_robin' | 'priority' | 'random' | 'moderated';

/**
 * 轮次配置
 */
export interface TurnConfig {
  strategy: TurnStrategy;
  turnTimeout: number;          // 单轮超时（ms）
  maxTurnsPerRound: number;     // 每轮最大发言数
  allowInterruption: boolean;   // 是否允许打断
}

/**
 * 默认轮次配置
 */
export const DEFAULT_TURN_CONFIG: TurnConfig = {
  strategy: 'round_robin',
  turnTimeout: 60000,           // 1 分钟
  maxTurnsPerRound: 10,
  allowInterruption: false,
};

/**
 * 轮次状态
 */
export interface TurnState {
  currentSpeaker?: string;      // 当前发言者 ID
  queue: string[];              // 发言队列
  round: number;                // 当前轮次
  turnsInRound: number;         // 当前轮次发言数
  startTime?: number;           // 当前轮开始时间
}

/**
 * 发言轮次管理器
 */
export class TurnManager {
  private config: TurnConfig;
  private agents: Map<string, Agent> = new Map();
  private state: TurnState;
  private turnCallback?: (agentId: string) => void;

  constructor(config?: Partial<TurnConfig>) {
    this.config = { ...DEFAULT_TURN_CONFIG, ...config };
    this.state = {
      queue: [],
      round: 0,
      turnsInRound: 0,
    };
  }

  /**
   * 设置参与者
   */
  setParticipants(agents: Agent[]): void {
    this.agents.clear();
    for (const agent of agents) {
      this.agents.set(agent.id, agent);
    }
    this.initializeQueue();
    
    logger.info('Participants set', { count: agents.length });
  }

  /**
   * 设置轮次回调
   */
  onTurn(callback: (agentId: string) => void): void {
    this.turnCallback = callback;
  }

  /**
   * 开始新一轮
   */
  startNewRound(): string | null {
    this.state.round++;
    this.state.turnsInRound = 0;
    this.initializeQueue();
    
    logger.info('New round started', { round: this.state.round });
    
    return this.nextTurn();
  }

  /**
   * 下一个发言者
   */
  nextTurn(): string | null {
    // 检查轮次限制
    if (this.state.turnsInRound >= this.config.maxTurnsPerRound) {
      logger.debug('Max turns reached', { round: this.state.round });
      return null;
    }

    // 获取下一个发言者
    const nextSpeakerId = this.state.queue.shift();
    if (!nextSpeakerId) {
      logger.debug('Queue empty');
      return null;
    }

    this.state.currentSpeaker = nextSpeakerId;
    this.state.turnsInRound++;
    this.state.startTime = Date.now();

    // 触发回调
    if (this.turnCallback) {
      this.turnCallback(nextSpeakerId);
    }

    logger.debug('Turn started', {
      speaker: nextSpeakerId,
      round: this.state.round,
      turn: this.state.turnsInRound,
    });

    return nextSpeakerId;
  }

  /**
   * 结束当前发言
   */
  endTurn(): void {
    if (!this.state.currentSpeaker) return;

    logger.debug('Turn ended', { speaker: this.state.currentSpeaker });
    this.state.currentSpeaker = undefined;
    this.state.startTime = undefined;
  }

  /**
   * 请求发言（用于打断模式）
   */
  requestTurn(agentId: string): boolean {
    if (!this.config.allowInterruption) {
      // 加入队列
      if (!this.state.queue.includes(agentId)) {
        this.state.queue.push(agentId);
        return true;
      }
      return false;
    }

    // 允许打断，直接切换
    this.endTurn();
    this.state.currentSpeaker = agentId;
    this.state.startTime = Date.now();
    return true;
  }

  /**
   * 获取当前状态
   */
  getState(): TurnState {
    return { ...this.state };
  }

  /**
   * 检查发言是否超时
   */
  isTimeout(): boolean {
    if (!this.state.startTime) return false;
    return Date.now() - this.state.startTime > this.config.turnTimeout;
  }

  /**
   * 获取剩余时间
   */
  getRemainingTime(): number {
    if (!this.state.startTime) return this.config.turnTimeout;
    return Math.max(0, this.config.turnTimeout - (Date.now() - this.state.startTime));
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * 初始化发言队列
   */
  private initializeQueue(): void {
    const agentIds = Array.from(this.agents.keys());

    switch (this.config.strategy) {
      case 'round_robin':
        this.state.queue = [...agentIds];
        break;

      case 'random':
        this.state.queue = this.shuffle([...agentIds]);
        break;

      case 'priority':
        // 可以根据 Agent 的某些属性排序
        this.state.queue = [...agentIds];
        break;

      case 'moderated':
        // 主持人模式，队列由外部控制
        this.state.queue = [];
        break;
    }
  }

  /**
   * 随机打乱数组
   */
  private shuffle(array: string[]): string[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}
