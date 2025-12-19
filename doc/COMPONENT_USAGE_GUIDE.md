# 组件使用指南

本文档总结了项目中所有可用的组件类型、交互模式和最佳实践。

## 目录

1. [基础组件](#基础组件)
2. [布局组件](#布局组件)
3. [抽象组件](#抽象组件)
4. [交互模式](#交互模式)
5. [代码示例](#代码示例)

## 基础组件

### Button（按钮）

**位置**: `src/components/ui/Button.tsx`

**变体（variant）**:
- `primary` - 主要操作（保存、提交、确认）
- `secondary` - 次要操作（取消、返回）
- `outline` - 边框按钮（中性操作）
- `ghost` - 无背景按钮（图标按钮、工具栏）
- `destructive` - 危险操作（删除、重置）

**尺寸（size）**:
- `sm` - 小尺寸（h-8）
- `default` - 默认尺寸（h-9）
- `lg` - 大尺寸（h-10）
- `icon` - 图标按钮（h-8 w-8）

**使用示例**:
```tsx
import { Button } from '@/components/ui/Button';

<Button variant="primary" size="default" onClick={handleSave}>
  保存
</Button>
```

### Input（输入框）

**位置**: `src/components/ui/Input.tsx`

**使用示例**:
```tsx
import { Input } from '@/components/ui/Input';

<Input 
  id="name" 
  value={name} 
  onChange={(e) => setName(e.target.value)}
  placeholder="请输入名称"
/>
```

### Textarea（多行文本）

**位置**: `src/components/ui/Textarea.tsx`

**使用示例**:
```tsx
import { Textarea } from '@/components/ui/Textarea';

<Textarea 
  id="description" 
  value={description} 
  onChange={(e) => setDescription(e.target.value)}
  rows={4}
/>
```

### Label（标签）

**位置**: `src/components/ui/Label.tsx`

**使用示例**:
```tsx
import { Label } from '@/components/ui/Label';

<Label htmlFor="name">名称</Label>
```

### Select（下拉选择）

**位置**: `src/components/ui/Select.tsx`

**使用示例**:
```tsx
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/Select';

<Select value={value} onValueChange={setValue}>
  <SelectTrigger>
    <SelectValue placeholder="请选择" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="option1">选项1</SelectItem>
    <SelectItem value="option2">选项2</SelectItem>
  </SelectContent>
</Select>
```

### Dialog（对话框）

**位置**: `src/components/ui/Dialog.tsx`

**使用示例**:
```tsx
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/Dialog';

<Dialog open={isOpen} onOpenChange={setIsOpen}>
  <DialogContent>
    <DialogHeader>
      <DialogTitle>标题</DialogTitle>
      <DialogDescription>描述</DialogDescription>
    </DialogHeader>
    <div>内容</div>
    <DialogFooter>
      <Button variant="secondary" onClick={() => setIsOpen(false)}>
        取消
      </Button>
      <Button variant="primary" onClick={handleConfirm}>
        确认
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### Toast（提示消息）

**位置**: `src/components/ui/use-toast.ts`

**使用示例**:
```tsx
import { toast } from '@/components/ui/use-toast';

toast({
  title: '操作成功',
  description: '配置已保存',
  variant: 'success',
});
```

## 布局组件

### PageLayout（页面布局）

**位置**: `src/components/ui/PageLayout.tsx`

**使用示例**:
```tsx
import PageLayout from '@/components/ui/PageLayout';

<PageLayout 
  title="页面标题" 
  description="页面描述"
  headerActions={<Button>操作</Button>}
>
  {/* 页面内容 */}
</PageLayout>
```

### Card（卡片）

**位置**: `src/components/ui/PageLayout.tsx`

**使用示例**:
```tsx
import { Card } from '@/components/ui/PageLayout';

<Card title="卡片标题" description="卡片描述" size="default">
  {/* 卡片内容 */}
</Card>
```

**尺寸（size）**:
- `compact` - 紧凑（p-3）
- `default` - 默认（p-4）
- `relaxed` - 宽松（p-5）

### ListItem（列表项）

**位置**: `src/components/ui/PageLayout.tsx`

**使用示例**:
```tsx
import { ListItem } from '@/components/ui/PageLayout';

<ListItem 
  active={isSelected} 
  onClick={handleSelect}
>
  <div>列表项内容</div>
</ListItem>
```

### Badge（徽章）

**位置**: `src/components/ui/PageLayout.tsx`

**使用示例**:
```tsx
import { Badge } from '@/components/ui/PageLayout';

<Badge variant="success">已启用</Badge>
<Badge variant="warning">待审核</Badge>
<Badge variant="error">已禁用</Badge>
```

### EmptyState（空状态）

**位置**: `src/components/ui/PageLayout.tsx`

**使用示例**:
```tsx
import { EmptyState } from '@/components/ui/PageLayout';
import { Inbox } from 'lucide-react';

<EmptyState
  icon={Inbox}
  title="暂无数据"
  description="还没有任何项目"
  action={<Button>创建项目</Button>}
/>
```

## 抽象组件

### IconButton（图标按钮）

**位置**: `src/components/ui/IconButton.tsx`

**使用示例**:
```tsx
import { IconButton } from '@/components/ui/IconButton';
import { Plus, Trash2 } from 'lucide-react';

<IconButton icon={Plus} onClick={handleAdd} label="添加" />
<IconButton icon={Trash2} variant="destructive" onClick={handleDelete} />
```

### IconButtonWithText（带文本的图标按钮）

**使用示例**:
```tsx
import { IconButtonWithText } from '@/components/ui/IconButton';
import { Plus } from 'lucide-react';

<IconButtonWithText icon={Plus} onClick={handleAdd}>
  添加项目
</IconButtonWithText>
```

### ConfirmDialog（确认对话框）

**位置**: `src/components/ui/ConfirmDialog.tsx`

**使用示例**:
```tsx
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

<ConfirmDialog
  open={showDeleteDialog}
  onOpenChange={setShowDeleteDialog}
  title="删除确认"
  description="确定要删除这个项目吗？此操作不可撤销。"
  variant="destructive"
  onConfirm={handleDelete}
/>
```

### LoadingSpinner（加载指示器）

**位置**: `src/components/ui/LoadingSpinner.tsx`

**使用示例**:
```tsx
import { LoadingSpinner, LoadingOverlay } from '@/components/ui/LoadingSpinner';

// 内联加载
<LoadingSpinner size="md" text="加载中..." />

// 全屏加载遮罩
<LoadingOverlay isLoading={isLoading} text="加载中..." />
```

### FormField（表单字段）

**位置**: `src/components/ui/FormField.tsx`

**使用示例**:
```tsx
import { InputField, TextareaField, FormFieldGroup } from '@/components/ui/FormField';

<FormFieldGroup spacing="default">
  <InputField
    label="名称"
    required
    error={errors.name}
    inputProps={{
      id: "name",
      value: name,
      onChange: (e) => setName(e.target.value),
    }}
  />
  <TextareaField
    label="描述"
    hint="请输入详细描述"
    textareaProps={{
      id: "description",
      value: description,
      onChange: (e) => setDescription(e.target.value),
    }}
  />
</FormFieldGroup>
```

### DataListItem（数据列表项）

**位置**: `src/components/ui/DataListItem.tsx`

**使用示例**:
```tsx
import { DataListItem } from '@/components/ui/DataListItem';

<DataListItem
  id={item.id}
  title={item.name}
  description={item.description}
  avatar={item.avatar}
  isSelected={selectedId === item.id}
  onClick={() => handleSelect(item.id)}
  onDelete={(e) => handleDelete(e, item.id)}
  onEdit={(e) => handleEdit(e, item.id)}
/>
```

## 交互模式

### 表单页面模式

```tsx
import PageLayout, { Card, FormFieldGroup } from '@/components/ui/PageLayout';
import { InputField, TextareaField } from '@/components/ui/FormField';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/use-toast';

const FormPage: React.FC = () => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState({});

  const handleSave = async () => {
    try {
      await saveData({ name, description });
      toast({
        title: '保存成功',
        variant: 'success',
      });
    } catch (error) {
      toast({
        title: '保存失败',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  return (
    <PageLayout title="表单页面">
      <Card title="基本信息">
        <FormFieldGroup>
          <InputField
            label="名称"
            required
            error={errors.name}
            inputProps={{
              id: "name",
              value: name,
              onChange: (e) => setName(e.target.value),
            }}
          />
          <TextareaField
            label="描述"
            textareaProps={{
              id: "description",
              value: description,
              onChange: (e) => setDescription(e.target.value),
            }}
          />
        </FormFieldGroup>
      </Card>
      
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={() => {}}>
          取消
        </Button>
        <Button variant="primary" onClick={handleSave}>
          保存
        </Button>
      </div>
    </PageLayout>
  );
};
```

### 列表页面模式

```tsx
import PageLayout, { Card, EmptyState, ListItem } from '@/components/ui/PageLayout';
import { DataListItem } from '@/components/ui/DataListItem';
import { Button, IconButton } from '@/components/ui/Button';
import { Plus, Inbox } from 'lucide-react';

const ListPage: React.FC = () => {
  const [items, setItems] = useState([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <PageLayout 
      title="列表页面" 
      headerActions={
        <Button variant="primary" onClick={handleAdd}>
          <Plus className="w-4 h-4 mr-2" />
          添加
        </Button>
      }
    >
      {items.length === 0 ? (
        <EmptyState
          icon={Inbox}
          title="暂无数据"
          action={
            <Button variant="primary" onClick={handleAdd}>
              创建第一个
            </Button>
          }
        />
      ) : (
        <Card>
          {items.map(item => (
            <DataListItem
              key={item.id}
              id={item.id}
              title={item.name}
              description={item.description}
              avatar={item.avatar}
              isSelected={selectedId === item.id}
              onClick={() => setSelectedId(item.id)}
              onDelete={(e) => handleDelete(e, item.id)}
              onEdit={(e) => handleEdit(e, item.id)}
            />
          ))}
        </Card>
      )}
    </PageLayout>
  );
};
```

### 删除确认模式

```tsx
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useState } from 'react';

const DeleteExample: React.FC = () => {
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Item | null>(null);

  const handleDeleteClick = (item: Item) => {
    setDeleteTarget(item);
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = async () => {
    if (deleteTarget) {
      await deleteItem(deleteTarget.id);
      setDeleteTarget(null);
    }
  };

  return (
    <>
      <IconButton 
        icon={Trash2} 
        variant="destructive" 
        onClick={() => handleDeleteClick(item)}
      />
      
      <ConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title="删除确认"
        description={`确定要删除「${deleteTarget?.name}」吗？此操作不可撤销。`}
        variant="destructive"
        onConfirm={handleConfirmDelete}
      />
    </>
  );
};
```

### 加载状态模式

```tsx
import { LoadingSpinner, LoadingOverlay } from '@/components/ui/LoadingSpinner';

// 内联加载
const InlineLoading: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);

  if (isLoading) {
    return <LoadingSpinner size="md" text="加载中..." />;
  }

  return <div>内容</div>;
};

// 全屏加载遮罩
const PageWithOverlay: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);

  return (
    <>
      <LoadingOverlay isLoading={isLoading} text="加载中..." />
      <div>页面内容</div>
    </>
  );
};
```

## 代码示例

### 完整的配置页面示例

```tsx
import React, { useState, useEffect } from 'react';
import PageLayout, { Card, FormFieldGroup, EmptyState } from '@/components/ui/PageLayout';
import { InputField, TextareaField } from '@/components/ui/FormField';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { toast } from '@/components/ui/use-toast';
import { Plus, Trash2, Edit2, Save } from 'lucide-react';

interface Config {
  id: string;
  name: string;
  description: string;
}

const ConfigPage: React.FC = () => {
  const [configs, setConfigs] = useState<Config[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Config | null>(null);
  const [formData, setFormData] = useState({ name: '', description: '' });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    loadConfigs();
  }, []);

  const loadConfigs = async () => {
    setIsLoading(true);
    try {
      const data = await fetchConfigs();
      setConfigs(data);
    } catch (error) {
      toast({
        title: '加载失败',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    // 验证
    const newErrors: any = {};
    if (!formData.name.trim()) {
      newErrors.name = '名称不能为空';
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    try {
      if (editingId) {
        await updateConfig(editingId, formData);
        toast({ title: '更新成功', variant: 'success' });
      } else {
        await createConfig(formData);
        toast({ title: '创建成功', variant: 'success' });
      }
      setEditingId(null);
      setFormData({ name: '', description: '' });
      setErrors({});
      loadConfigs();
    } catch (error) {
      toast({
        title: '保存失败',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteConfig(deleteTarget.id);
      toast({ title: '删除成功', variant: 'success' });
      setDeleteTarget(null);
      loadConfigs();
    } catch (error) {
      toast({
        title: '删除失败',
        description: error.message,
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <PageLayout title="配置管理">
        <LoadingSpinner size="lg" text="加载中..." />
      </PageLayout>
    );
  }

  return (
    <PageLayout 
      title="配置管理" 
      headerActions={
        <Button 
          variant="primary" 
          onClick={() => {
            setEditingId(null);
            setFormData({ name: '', description: '' });
            setErrors({});
          }}
        >
          <Plus className="w-4 h-4 mr-2" />
          新建
        </Button>
      }
    >
      <Card title={editingId ? '编辑配置' : '新建配置'}>
        <FormFieldGroup>
          <InputField
            label="名称"
            required
            error={errors.name}
            inputProps={{
              id: "name",
              value: formData.name,
              onChange: (e) => setFormData({ ...formData, name: e.target.value }),
            }}
          />
          <TextareaField
            label="描述"
            textareaProps={{
              id: "description",
              value: formData.description,
              onChange: (e) => setFormData({ ...formData, description: e.target.value }),
            }}
          />
        </FormFieldGroup>
        <div className="mt-4 flex justify-end gap-2">
          <Button 
            variant="secondary" 
            onClick={() => {
              setEditingId(null);
              setFormData({ name: '', description: '' });
              setErrors({});
            }}
          >
            取消
          </Button>
          <Button variant="primary" onClick={handleSave}>
            <Save className="w-4 h-4 mr-2" />
            保存
          </Button>
        </div>
      </Card>

      <Card title="配置列表" className="mt-6">
        {configs.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="暂无配置"
            description="点击上方按钮创建第一个配置"
          />
        ) : (
          <div className="space-y-2">
            {configs.map(config => (
              <div
                key={config.id}
                className="flex items-center justify-between p-3 rounded-md border border-borderToken hover:bg-mutedToken"
              >
                <div>
                  <div className="font-medium">{config.name}</div>
                  {config.description && (
                    <div className="text-sm text-mutedToken-foreground mt-1">
                      {config.description}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <IconButton
                    icon={Edit2}
                    label="编辑"
                    onClick={() => {
                      setEditingId(config.id);
                      setFormData({
                        name: config.name,
                        description: config.description,
                      });
                      setErrors({});
                    }}
                  />
                  <IconButton
                    icon={Trash2}
                    label="删除"
                    variant="destructive"
                    onClick={() => setDeleteTarget(config)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="删除确认"
        description={`确定要删除「${deleteTarget?.name}」吗？此操作不可撤销。`}
        variant="destructive"
        onConfirm={handleDelete}
      />
    </PageLayout>
  );
};

export default ConfigPage;
```

## 总结

1. **优先使用组件库** - 所有 UI 元素必须使用 `src/components/ui/` 中的组件
2. **使用抽象组件** - 对于重复的模式，使用抽象组件（IconButton、ConfirmDialog、FormField 等）
3. **保持一致性** - 遵循 `.cursorrules` 中的规范和 UX 风格偏好
4. **类型安全** - 使用 TypeScript 严格类型定义
5. **可访问性** - 为图标按钮添加 `label` 属性，为表单字段添加 `htmlFor` 和 `id`

