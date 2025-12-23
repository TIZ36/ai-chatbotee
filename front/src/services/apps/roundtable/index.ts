/**
 * RoundTable Module
 * 圆桌会议模块统一导出
 */

export {
  TurnManager,
  type TurnStrategy,
  type TurnConfig,
  type TurnState,
  DEFAULT_TURN_CONFIG,
} from './TurnManager';

export {
  RoundTableOrchestrator,
  type RoundTableConfig,
  type RoundTableStatus,
  type RoundTableRecord,
  type TranscriptEntry,
  DEFAULT_ROUNDTABLE_CONFIG,
} from './RoundTableOrchestrator';
