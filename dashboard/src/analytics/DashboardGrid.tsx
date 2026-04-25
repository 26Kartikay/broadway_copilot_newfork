import {
  DndContext, KeyboardSensor, PointerSensor, closestCenter,
  useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, rectSortingStrategy,
  sortableKeyboardCoordinates, useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { QueryResponse } from './analyticsApi';
import { ResultCard } from './ResultCard';

interface Item { id: string; result: QueryResponse; }

function SortableCard({ id, result, onRemove }: Item & { onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, position: 'relative' }}>
      <div
        {...attributes} {...listeners}
        style={{ position: 'absolute', top: '0.75rem', left: '-1.5rem', cursor: 'grab', color: 'var(--color-border)', zIndex: 1, padding: '4px' }}
      >
        <GripVertical size={14} />
      </div>
      <ResultCard result={result} onRemove={onRemove} />
    </div>
  );
}

interface Props {
  items: Item[];
  onReorder: (items: Item[]) => void;
  onRemove: (id: string) => void;
}

export function DashboardGrid({ items, onReorder, onRemove }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const oi = items.findIndex(i => i.id === active.id);
    const ni = items.findIndex(i => i.id === over.id);
    const next = [...items];
    next.splice(oi, 1);
    next.splice(ni, 0, items[oi]);
    onReorder(next);
  };

  if (items.length === 0) return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '5rem 2rem', color: 'var(--color-text-muted)' }}>
      <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📊</div>
      <p style={{ fontSize: '1rem', fontWeight: 500 }}>Ask a question to build your dashboard</p>
      <p style={{ fontSize: '0.875rem', marginTop: '0.25rem' }}>Results appear here — drag to rearrange</p>
    </div>
  );

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map(i => i.id)} strategy={rectSortingStrategy}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(520px, 1fr))', gap: '1.25rem', paddingLeft: '1.5rem' }}>
          {items.map(item => (
            <SortableCard key={item.id} {...item} onRemove={() => onRemove(item.id)} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
