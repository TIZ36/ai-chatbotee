import React from 'react';
import { Plus, MessageCircle, Users, BookOpen } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { ScrollArea } from '../../ui/ScrollArea';
import { DataListItem } from '../../ui/DataListItem';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../ui/Dialog';
import type { Session } from '../../../services/sessionApi';
import type { RoundTable } from '../../../services/roundTableApi';

export interface PersonaPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personaSearch: string;
  setPersonaSearch: (value: string) => void;
  isLoadingPersonaList: boolean;
  personaAgents: Session[];
  personaMeetings: RoundTable[];
  personaResearchSessions: Session[];
  isTemporarySession: boolean;
  currentSessionId: string | null;
  temporarySessionId: string;
  onSwitchSession: (sessionId: string) => void;
  onOpenMeeting: (roundTableId: string) => void;
  onOpenResearch: (sessionId: string) => void;
  onDeleteAgent: (id: string, name: string) => void;
  onDeleteMeeting: (id: string, name: string) => void;
  onDeleteResearch: (id: string, name: string) => void;
  onShowRoleGenerator: () => void;
  onShowNewMeetingDialog: () => void;
  onShowNewResearchDialog: () => void;
}

export const PersonaPanel: React.FC<PersonaPanelProps> = ({
  open,
  onOpenChange,
  personaSearch,
  setPersonaSearch,
  isLoadingPersonaList,
  personaAgents,
  personaMeetings,
  personaResearchSessions,
  isTemporarySession,
  currentSessionId,
  temporarySessionId,
  onSwitchSession,
  onOpenMeeting,
  onOpenResearch,
  onDeleteAgent,
  onDeleteMeeting,
  onDeleteResearch,
  onShowRoleGenerator,
  onShowNewMeetingDialog,
  onShowNewResearchDialog,
}) => {
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        onOpenChange(open);
        if (!open) setPersonaSearch('');
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>选择人设</DialogTitle>
          <DialogDescription>按类型选择：Agent / Meeting / Research</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Input
            value={personaSearch}
            onChange={(e) => setPersonaSearch(e.target.value)}
            placeholder="搜索 agent / meeting / research..."
            className="h-9"
          />
          <Button
            variant="secondary"
            onClick={() => {
              onShowRoleGenerator();
              onOpenChange(false);
            }}
            title="创建/生成一个新的人设（角色）"
          >
            <Plus className="w-4 h-4" />
            <span>新建Agent</span>
          </Button>
        </div>

        <ScrollArea className="h-[60vh] pr-2">
          <div className="space-y-4 py-2">
            {/* Agent */}
            <div>
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-200 px-1 mb-1">Agent</div>
              <div className="space-y-1">
                {('临时会话'.includes(personaSearch.trim()) || !personaSearch.trim()) && (
                  <DataListItem
                    id="temporary-session"
                    title="临时会话"
                    description="不保存历史"
                    icon={MessageCircle}
                    isSelected={isTemporarySession}
                    onClick={() => onSwitchSession(temporarySessionId)}
                  />
                )}
                {isLoadingPersonaList ? (
                  <div className="text-xs text-gray-500 dark:text-[#808080] px-1 py-2">加载中...</div>
                ) : (
                  personaAgents
                    .filter((a) => {
                      const q = personaSearch.trim().toLowerCase();
                      if (!q) return true;
                      const name = (a.name || a.title || a.session_id).toLowerCase();
                      const prompt = (a.system_prompt || '').toLowerCase();
                      return name.includes(q) || prompt.includes(q);
                    })
                    .map((a) => (
                      <DataListItem
                        key={a.session_id}
                        id={a.session_id}
                        title={a.name || a.title || `Agent ${a.session_id.slice(0, 8)}`}
                        description={a.system_prompt ? a.system_prompt.split('\n')[0]?.slice(0, 80) + (a.system_prompt.length > 80 ? '...' : '') : `${a.message_count || 0} 条消息 · ${a.last_message_at ? new Date(a.last_message_at).toLocaleDateString() : '无记录'}`}
                        avatar={a.avatar || undefined}
                        isSelected={!isTemporarySession && currentSessionId === a.session_id}
                        onClick={() => onSwitchSession(a.session_id)}
                        onDelete={(e) => {
                          e.stopPropagation();
                          onDeleteAgent(a.session_id, a.name || a.title || `Agent ${a.session_id.slice(0, 8)}`);
                        }}
                      />
                    ))
                )}
              </div>
            </div>

            {/* Meeting */}
            <div>
              <div className="flex items-center justify-between px-1 mb-1">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Meeting</div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onShowNewMeetingDialog}
                  className="h-6 px-2 text-xs"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  新建
                </Button>
              </div>
              <div className="space-y-1">
                {isLoadingPersonaList ? (
                  <div className="text-xs text-gray-500 dark:text-[#808080] px-1 py-2">加载中...</div>
                ) : (
                  personaMeetings
                    .filter((m) => {
                      const q = personaSearch.trim().toLowerCase();
                      if (!q) return true;
                      return (m.name || '').toLowerCase().includes(q);
                    })
                    .map((m) => (
                      <DataListItem
                        key={m.round_table_id}
                        id={m.round_table_id}
                        title={m.name || `会议 ${m.round_table_id.slice(0, 8)}`}
                        description={`${m.participant_count} 人 · ${m.status === 'active' ? '进行中' : '已关闭'}`}
                        icon={Users}
                        onClick={() => onOpenMeeting(m.round_table_id)}
                        onDelete={(e) => {
                          e.stopPropagation();
                          onDeleteMeeting(m.round_table_id, m.name || `会议 ${m.round_table_id.slice(0, 8)}`);
                        }}
                      />
                    ))
                )}
                {!isLoadingPersonaList && personaMeetings.length === 0 && (
                  <div className="text-xs text-gray-500 dark:text-[#808080] px-1 py-2">暂无会议</div>
                )}
              </div>
            </div>

            {/* Research */}
            <div>
              <div className="flex items-center justify-between px-1 mb-1">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-200">Research</div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onShowNewResearchDialog}
                  className="h-6 px-2 text-xs"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  新建
                </Button>
              </div>
              <div className="space-y-1">
                {isLoadingPersonaList ? (
                  <div className="text-xs text-gray-500 dark:text-[#808080] px-1 py-2">加载中...</div>
                ) : (
                  personaResearchSessions
                    .filter((s) => {
                      const q = personaSearch.trim().toLowerCase();
                      if (!q) return true;
                      const name = (s.name || s.title || s.session_id).toLowerCase();
                      return name.includes(q);
                    })
                    .map((s) => (
                      <DataListItem
                        key={s.session_id}
                        id={s.session_id}
                        title={s.name || s.title || `Research ${s.session_id.slice(0, 8)}`}
                        description="研究资料与检索"
                        icon={BookOpen}
                        onClick={() => onOpenResearch(s.session_id)}
                        onDelete={(e) => {
                          e.stopPropagation();
                          onDeleteResearch(s.session_id, s.name || s.title || `Research ${s.session_id.slice(0, 8)}`);
                        }}
                      />
                    ))
                )}
                {!isLoadingPersonaList && personaResearchSessions.length === 0 && (
                  <div className="text-xs text-gray-500 dark:text-[#808080] px-1 py-2">暂无 Research 会话</div>
                )}
              </div>
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
