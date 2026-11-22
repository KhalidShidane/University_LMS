import { useEffect, useRef, useState } from 'react'
import { GripVertical } from 'lucide-react'
import { noteContextLabel, noteTitle, relativeTime } from './noteUtils.js'

/**
 * Note list with pointer-based (mouse, touch, pen) and keyboard reordering.
 * Reordering is only offered when `reorderable` is true (custom order, no search).
 */
export default function NoteList({ notes, selectedId, onSelect, reorderable = false, onReorder, showContext = true }) {
  const [items, setItems] = useState(notes)
  const [draggingId, setDraggingId] = useState(null)
  const listRef = useRef(null)
  const dragRef = useRef(null)
  const itemRefs = useRef(new Map())
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => { if (!dragRef.current) setItems(notes) }, [notes])

  function commit(nextItems) {
    const before = notes.map((note) => note._id).join(',')
    const after = nextItems.map((note) => note._id).join(',')
    if (before !== after) onReorder?.(nextItems)
  }

  function onPointerDown(event, id) {
    if (!reorderable || (event.pointerType === 'mouse' && event.button !== 0)) return
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    dragRef.current = { id, pointerId: event.pointerId, moved: false }
    setDraggingId(id)
  }

  function onPointerMove(event) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    drag.moved = true
    const y = event.clientY
    // Auto-scroll the nearest scrolling container while dragging near its edges.
    const scroller = listRef.current?.closest('.notes-scroll')
    if (scroller) {
      const box = scroller.getBoundingClientRect()
      if (y < box.top + 40) scroller.scrollTop -= 12
      else if (y > box.bottom - 40) scroller.scrollTop += 12
    }
    setItems((current) => {
      const from = current.findIndex((note) => note._id === drag.id)
      if (from < 0) return current
      let to = from
      for (let index = 0; index < current.length; index += 1) {
        if (index === from) continue
        const element = itemRefs.current.get(current[index]._id)
        if (!element) continue
        const rect = element.getBoundingClientRect()
        const middle = rect.top + rect.height / 2
        if (index < from && y < middle) { to = index; break }
        if (index > from && y > middle) to = index
      }
      if (to === from) return current
      const next = [...current]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  function onPointerUp(event) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    setDraggingId(null)
    if (drag.moved) commit(itemsRef.current)
  }

  function onHandleKeyDown(event, index) {
    if (!reorderable || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const target = event.key === 'ArrowUp' ? index - 1 : index + 1
    if (target < 0 || target >= items.length) return
    const next = [...items]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    setItems(next)
    commit(next)
    requestAnimationFrame(() => itemRefs.current.get(moved._id)?.querySelector('.note-drag-handle')?.focus())
  }

  return <ul className={`note-list ${draggingId ? 'is-sorting' : ''}`} ref={listRef} aria-label="Notes">
    {items.map((note, index) => <li
      key={note._id}
      ref={(element) => { if (element) itemRefs.current.set(note._id, element); else itemRefs.current.delete(note._id) }}
      className={`note-list-item note-color-${note.color || 'default'} ${selectedId === note._id ? 'is-selected' : ''} ${draggingId === note._id ? 'is-dragging' : ''}`}
    >
      {reorderable && <button
        type="button"
        className="note-drag-handle"
        aria-label={`Reorder ${noteTitle(note)}. Use the up and down arrow keys to move it.`}
        title="Drag to reorder"
        onPointerDown={(event) => onPointerDown(event, note._id)}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(event) => onHandleKeyDown(event, index)}
      ><GripVertical size={15} /></button>}
      <button type="button" className="note-list-main" onClick={() => onSelect(note)} aria-current={selectedId === note._id ? 'true' : undefined}>
        <span className="note-list-title">{noteTitle(note)}</span>
        {note.excerpt ? <span className="note-list-excerpt">{note.excerpt}</span> : <span className="note-list-excerpt is-empty">No content yet</span>}
        <span className="note-list-meta">
          {showContext && <span className="note-list-context">{noteContextLabel(note)}</span>}
          <span>{relativeTime(note.updatedAt)}</span>
          {note.tags?.slice(0, 3).map((tag) => <span className="note-tag-chip" key={tag}>#{tag}</span>)}
        </span>
      </button>
    </li>)}
  </ul>
}
